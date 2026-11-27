import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import { canCreateCompany, getCompany, getViewer, requireAdmin } from "./lib/access";
import { canonicalTimeZone, isIsoDate } from "./lib/dates";
import { isValidPoint } from "./lib/geo";
import {
  addressOf,
  cleanSenderName,
  DEFAULT_LOCAL_PART,
  emailSender,
  isDomain,
  isLocalPart,
  type Sender,
} from "./lib/sender";
import { cleanEmail, isEmail } from "./lib/text";
import { serviceArea } from "./schema";

// A company and its settings. Creating one is only for the emails in
// COMPANY_CREATOR_EMAILS; from then on its owner and admins manage it here and
// its users in `members.ts`.

const DEFAULT_TEMPLATES = {
  vencimiento: "recordatorio_pago_vencimiento",
  proximo: "recordatorio_pago_proximo",
  lang: "es_MX",
};

/** Name, zone and the rest of what the company's own settings page edits, checked. */
function companyFields(args: {
  name: string;
  timeZone: string;
  phoneCountryCode: string;
  tagline?: string;
}) {
  const name = args.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) throw new ConvexError("Escribe el nombre de la empresa.");
  if (name.length > 80) throw new ConvexError("El nombre de la empresa es demasiado largo.");

  const timeZone = canonicalTimeZone(args.timeZone);
  if (!timeZone) throw new ConvexError("Esa zona horaria no es válida.");

  const phoneCountryCode = args.phoneCountryCode.replace(/[\s+]/g, "");
  if (!/^[1-9]\d{0,3}$/.test(phoneCountryCode)) {
    throw new ConvexError("La clave de país del teléfono no es válida (por ejemplo, 52 para México).");
  }

  const tagline = (args.tagline ?? "").trim().replace(/\s+/g, " ");
  if (tagline.length > 120) throw new ConvexError("El lema es demasiado largo.");

  return { name, timeZone, phoneCountryCode, tagline: tagline || undefined };
}

/**
 * Creates a company with the caller as its owner. Only for people who aren't in
 * a company yet and whose email is in COMPANY_CREATOR_EMAILS.
 */
export const create = mutation({
  args: { name: v.string(), timeZone: v.string(), phoneCountryCode: v.string() },
  handler: async (ctx, args) => {
    const viewer = await getViewer(ctx);
    if (viewer === null) throw new ConvexError("No tienes acceso a esta aplicación.");
    const { user, member } = viewer;
    if (member) throw new ConvexError("Tu correo ya pertenece a una empresa.");
    if (!user.email || !canCreateCompany(user.email)) {
      throw new ConvexError("Tu correo no está autorizado para crear una empresa.");
    }

    const companyId = await ctx.db.insert("companies", companyFields(args));
    await ctx.db.insert("members", {
      companyId,
      email: cleanEmail(user.email),
      role: "owner",
      addedBy: user._id,
    });
    return companyId;
  },
});

const secretsOf = (ctx: QueryCtx, company: Doc<"companies">) =>
  ctx.db
    .query("companySecrets")
    .withIndex("by_company", (q) => q.eq("companyId", company._id))
    .first();

/** Everything the settings pages show. The WhatsApp token never leaves the server. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const { companyId } = await requireAdmin(ctx, "manageCompany");
    const company = await getCompany(ctx, companyId);
    const secrets = await secretsOf(ctx, company);
    const reminders = company.reminders ?? {};
    const sender = emailSender(company, process.env.REMINDER_DEFAULT_FROM_EMAIL);
    return {
      name: company.name,
      timeZone: company.timeZone,
      phoneCountryCode: company.phoneCountryCode,
      tagline: company.tagline ?? "",
      serviceArea: company.serviceArea ?? null,
      reminders: {
        startDate: reminders.startDate ?? "",
        fromName: reminders.fromName ?? "",
        fromLocalPart: reminders.fromLocalPart ?? "",
        replyTo: reminders.replyTo ?? "",
        whatsapp: reminders.whatsapp
          ? {
              phoneNumberId: reminders.whatsapp.phoneNumberId,
              templateVencimiento: reminders.whatsapp.templateVencimiento ?? "",
              templateProximo: reminders.whatsapp.templateProximo ?? "",
              lang: reminders.whatsapp.lang ?? "",
            }
          : null,
      },
      // The company's own verified domain, or the shared address it sends from.
      senderDomain: company.senderDomain ?? null,
      sharedAddress: company.senderDomain
        ? null
        : addressOf(process.env.REMINDER_DEFAULT_FROM_EMAIL),
      defaultLocalPart: DEFAULT_LOCAL_PART,
      defaultTemplates: DEFAULT_TEMPLATES,
      sender: "error" in sender ? { from: null, error: sender.error } : { from: sender.from, error: null },
      hasWhatsAppToken: Boolean(secrets?.whatsappToken),
      remindersLastRunOn: company.remindersLastRunOn ?? null,
    };
  },
});

export const update = mutation({
  args: {
    name: v.string(),
    timeZone: v.string(),
    phoneCountryCode: v.string(),
    tagline: v.string(),
    // Left out = unchanged; null = no service area (address search everywhere).
    serviceArea: v.optional(v.union(serviceArea, v.null())),
  },
  handler: async (ctx, { serviceArea: area, ...args }) => {
    const { companyId } = await requireAdmin(ctx, "manageCompany");
    if (area) {
      const { center, bounds } = area;
      const corners = [
        { lat: bounds.south, lng: bounds.west },
        { lat: bounds.north, lng: bounds.east },
      ];
      if (
        ![center, ...corners].every(isValidPoint) ||
        bounds.south >= bounds.north ||
        bounds.west >= bounds.east
      ) {
        throw new ConvexError("La zona de servicio no es válida.");
      }
    }
    await ctx.db.patch(companyId, {
      ...companyFields(args),
      ...(area === undefined ? {} : { serviceArea: area ?? undefined }),
    });
  },
});

/** How the payment reminders are sent, and from which delivery day on. */
export const updateReminders = mutation({
  args: {
    // "" turns the reminders off.
    startDate: v.string(),
    fromName: v.string(),
    fromLocalPart: v.string(),
    replyTo: v.string(),
    whatsapp: v.union(
      v.null(),
      v.object({
        phoneNumberId: v.string(),
        templateVencimiento: v.string(),
        templateProximo: v.string(),
        lang: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { companyId } = await requireAdmin(ctx, "manageCompany");

    const startDate = args.startDate.trim();
    if (startDate && !isIsoDate(startDate)) {
      throw new ConvexError("La fecha de inicio no es válida.");
    }

    const fromName = cleanSenderName(args.fromName);
    if (fromName.length > 80) throw new ConvexError("El nombre del remitente es demasiado largo.");

    const fromLocalPart = args.fromLocalPart.trim().toLowerCase();
    if (fromLocalPart && !isLocalPart(fromLocalPart)) {
      throw new ConvexError(
        'La dirección del remitente solo puede tener letras, números, puntos y guiones (por ejemplo, "cobranza").',
      );
    }

    const replyTo = cleanEmail(args.replyTo);
    if (replyTo && !isEmail(replyTo)) throw new ConvexError("El correo de respuesta no es válido.");

    let whatsapp: NonNullable<Doc<"companies">["reminders"]>["whatsapp"];
    if (args.whatsapp) {
      const phoneNumberId = args.whatsapp.phoneNumberId.trim();
      if (!/^\d{5,20}$/.test(phoneNumberId)) {
        throw new ConvexError(
          "El identificador del número de WhatsApp solo tiene dígitos. Cópialo de Meta: no es el número de teléfono.",
        );
      }
      const template = (value: string) => {
        const name = value.trim();
        if (name && !/^[a-z0-9_]{1,512}$/.test(name)) {
          throw new ConvexError(
            "El nombre de una plantilla solo tiene minúsculas, números y guiones bajos.",
          );
        }
        return name || undefined;
      };
      const lang = args.whatsapp.lang.trim();
      if (lang && !/^[a-z]{2,3}(_[A-Z]{2})?$/.test(lang)) {
        throw new ConvexError('El idioma de las plantillas se escribe como "es_MX".');
      }
      whatsapp = {
        phoneNumberId,
        templateVencimiento: template(args.whatsapp.templateVencimiento),
        templateProximo: template(args.whatsapp.templateProximo),
        lang: lang || undefined,
      };
    }

    await ctx.db.patch(companyId, {
      reminders: {
        startDate: startDate || undefined,
        fromName: fromName || undefined,
        fromLocalPart: fromLocalPart || undefined,
        replyTo: replyTo || undefined,
        whatsapp,
      },
    });
  },
});

/** Saves the WhatsApp token ("" removes it). It can be replaced but never read back. */
export const setWhatsAppToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const { companyId } = await requireAdmin(ctx, "manageCompany");
    const token = args.token.trim();
    if (token && (token.length < 20 || /\s/.test(token))) {
      throw new ConvexError("Ese token no parece válido. Cópialo completo desde Meta.");
    }
    const secrets = await secretsOf(ctx, await getCompany(ctx, companyId));
    const whatsappToken = token || undefined;
    if (secrets) await ctx.db.patch(secrets._id, { whatsappToken });
    else await ctx.db.insert("companySecrets", { companyId, whatsappToken });
  },
});

/** What `reminders.ts` needs to send a company's messages. */
export type ReminderConfig = {
  companyName: string;
  tagline: string | null;
  timeZone: string;
  /** First delivery day that gets reminders; null = reminders off. */
  startDate: string | null;
  sender: Sender;
  whatsapp: {
    token: string;
    phoneNumberId: string;
    templateVencimiento: string;
    templateProximo: string;
    lang: string;
  } | null;
};

async function reminderConfigOf(ctx: QueryCtx, company: Doc<"companies">): Promise<ReminderConfig> {
  const token = (await secretsOf(ctx, company))?.whatsappToken;
  const whatsapp = company.reminders?.whatsapp;
  return {
    companyName: company.name,
    tagline: company.tagline ?? null,
    timeZone: company.timeZone,
    startDate: company.reminders?.startDate ?? null,
    sender: emailSender(company, process.env.REMINDER_DEFAULT_FROM_EMAIL),
    whatsapp:
      token && whatsapp
        ? {
            token,
            phoneNumberId: whatsapp.phoneNumberId,
            templateVencimiento: whatsapp.templateVencimiento ?? DEFAULT_TEMPLATES.vencimiento,
            templateProximo: whatsapp.templateProximo ?? DEFAULT_TEMPLATES.proximo,
            lang: whatsapp.lang ?? DEFAULT_TEMPLATES.lang,
          }
        : null,
  };
}

/** Internal only: it includes the WhatsApp token. */
export const reminderConfig = internalQuery({
  args: { companyId: v.id("companies") },
  handler: async (ctx, { companyId }): Promise<ReminderConfig | null> => {
    const company = await ctx.db.get(companyId); // tenant-ok: internal, for the company it is told
    return company && (await reminderConfigOf(ctx, company));
  },
});

/** The caller's company's sender and the caller's own address, for `reminders.testSender`. */
export const viewerReminderConfig = internalQuery({
  args: {},
  handler: async (ctx): Promise<{ to: string; config: ReminderConfig }> => {
    const { user, companyId } = await requireAdmin(ctx, "manageCompany");
    if (!user.email) throw new ConvexError("Tu cuenta no tiene correo.");
    return {
      to: cleanEmail(user.email),
      config: await reminderConfigOf(ctx, await getCompany(ctx, companyId)),
    };
  },
});

// For whoever runs the deployment (`npx convex run companies:…`); never called by the app.

/** Every company, with its owner: `npx convex run companies:list`. */
export const list = internalQuery({
  args: {},
  handler: async (ctx) => {
    const companies = await ctx.db.query("companies").collect(); // tenant-ok: operator only
    return await Promise.all(
      companies.map(async (company) => {
        const members = await ctx.db
          .query("members")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect();
        return {
          _id: company._id,
          name: company.name,
          timeZone: company.timeZone,
          owner: members.find((m) => m.role === "owner")?.email ?? null,
          members: members.length,
          senderDomain: company.senderDomain ?? null,
          remindersFrom: company.reminders?.startDate ?? null,
          remindersLastRunOn: company.remindersLastRunOn ?? null,
        };
      }),
    );
  },
});

/**
 * Lets a company send its reminders from its own domain, once the domain is
 * verified in Resend: `npx convex run companies:setSenderDomain
 * '{"companyId": "…", "senderDomain": "empresa.com"}'` (null to go back to the
 * shared address). A domain belongs to one company only.
 */
export const setSenderDomain = internalMutation({
  args: { companyId: v.id("companies"), senderDomain: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const company = await ctx.db.get(args.companyId); // tenant-ok: operator only
    if (!company) throw new Error("Esa empresa no existe.");
    const senderDomain = args.senderDomain?.trim().toLowerCase() || undefined;
    if (senderDomain) {
      if (!isDomain(senderDomain)) throw new Error(`"${senderDomain}" no es un dominio.`);
      const companies = await ctx.db.query("companies").collect(); // tenant-ok: operator only
      const taken = companies.find((c) => c._id !== company._id && c.senderDomain === senderDomain);
      if (taken) throw new Error(`${senderDomain} ya es el dominio de "${taken.name}".`);
    }
    await ctx.db.patch(company._id, { senderDomain });
    return { company: company.name, senderDomain: senderDomain ?? null };
  },
});
