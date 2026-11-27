import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, type QueryCtx } from "./_generated/server";
import { emailList, type MemberRole } from "./lib/access";
import { LEGACY_TIME_ZONE } from "./lib/dates";
import { legacyCompanyId } from "./lib/tenancy";
import { cleanEmail } from "./lib/text";

// Prepares the data for several companies: creates the first one from what is
// configured today (env vars and values that were fixed in the code) and gives
// it every existing row. Access still comes from ADMIN_EMAILS / ALLOWED_EMAILS
// until the next version is deployed. In order (add `--prod` for production):
//
//   npx convex run migrations:backfillCompany '{"ownerEmail": "…", "dryRun": true}'
//   npx convex run migrations:backfillCompany '{"ownerEmail": "…"}'
//   npx convex run migrations:stampRows
//   npx convex run migrations:status
//
// All of them are safe to run again.

const FIRST_COMPANY = {
  name: "Bioclean Green Cozumel",
  timeZone: LEGACY_TIME_ZONE,
  phoneCountryCode: "52",
  tagline: "Servicio integral para su negocio · Desde 1996",
  // The island of Cozumel, and San Miguel.
  serviceArea: {
    center: { lat: 20.5083, lng: -86.9458 },
    bounds: { west: -87.06, south: 20.25, east: -86.7, north: 20.62 },
  },
};

const env = (name: string) => process.env[name]?.trim() || undefined;

/** `Nombre <correo@dominio>` or just `correo@dominio`, as REMINDER_FROM_EMAIL is written. */
function parseSender(value: string | undefined) {
  if (!value) return {};
  const match = /^(?:"?([^"<]*?)"?\s*<)?([^\s<>@]+)@([^\s<>@]+?)>?$/.exec(value);
  if (!match) {
    throw new Error(
      `REMINDER_FROM_EMAIL debe ser "Nombre <correo@dominio>" o "correo@dominio" (tiene "${value}").`,
    );
  }
  const [, name, localPart, domain] = match;
  return {
    fromName: name?.trim() || undefined,
    fromLocalPart: localPart,
    senderDomain: domain.toLowerCase(),
  };
}

/** The reminder settings of the first company, as the env vars have them now. */
function remindersFromEnv() {
  const { senderDomain, ...sender } = parseSender(env("REMINDER_FROM_EMAIL"));
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  return {
    senderDomain,
    whatsappToken: env("WHATSAPP_TOKEN"),
    reminders: {
      startDate: env("REMINDERS_START_DATE"),
      ...sender,
      replyTo: env("REMINDER_REPLY_TO"),
      whatsapp: phoneNumberId
        ? {
            phoneNumberId,
            templateVencimiento: env("WHATSAPP_TEMPLATE_VENCIMIENTO"),
            templateProximo: env("WHATSAPP_TEMPLATE_PROXIMO"),
            lang: env("WHATSAPP_TEMPLATE_LANG"),
          }
        : undefined,
    },
  };
}

/** The role each email on the access lists has; an admin who is also a driver stays admin. */
function rolesFromEnv(): Map<string, MemberRole> {
  const roles = new Map<string, MemberRole>();
  for (const email of emailList(process.env.ALLOWED_EMAILS)) roles.set(email, "driver");
  for (const email of emailList(process.env.ADMIN_EMAILS)) roles.set(email, "admin");
  return roles;
}

/**
 * Creates the first company, or brings it up to date with the env vars: while
 * they decide who has access, its members are exactly the emails on the lists.
 * `ownerEmail` is the admin who becomes its owner.
 */
export const backfillCompany = internalMutation({
  args: { ownerEmail: v.string(), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const companies = await ctx.db.query("companies").take(2);
    if (companies.length > 1) {
      throw new Error("Ya hay más de una empresa: el acceso ya no viene de las variables de entorno.");
    }
    const existing = companies[0] ?? null;

    const wanted = rolesFromEnv();
    const owner = cleanEmail(args.ownerEmail);
    if (wanted.get(owner) !== "admin") {
      throw new Error(`${owner} no está en ADMIN_EMAILS: el dueño tiene que ser uno de los administradores.`);
    }
    wanted.set(owner, "owner");

    const { senderDomain, whatsappToken, reminders } = remindersFromEnv();
    const base = (await ctx.db.query("settings").first())?.base;

    const members = existing
      ? await ctx.db
          .query("members")
          .withIndex("by_company", (q) => q.eq("companyId", existing._id))
          .collect()
      : [];
    const current = new Map(members.map((m) => [m.email, m]));
    const add = [...wanted].filter(([email]) => !current.has(email));
    const change = members.filter((m) => wanted.has(m.email) && wanted.get(m.email) !== m.role);
    const remove = members.filter((m) => !wanted.has(m.email));

    const summary = {
      dryRun: args.dryRun === true,
      company: existing ? "actualizada" : "nueva",
      name: existing?.name ?? FIRST_COMPANY.name,
      base: base ?? null,
      senderDomain: senderDomain ?? null,
      reminders,
      whatsappToken: whatsappToken ? "configurado" : "sin configurar",
      members: {
        added: add.map(([email, role]) => `${email} (${role})`).sort(),
        changed: change.map((m) => `${m.email} (${m.role} → ${wanted.get(m.email)})`).sort(),
        removed: remove.map((m) => m.email).sort(),
      },
    };
    if (args.dryRun) return summary;

    const fromEnv = { base, senderDomain, reminders };
    const companyId =
      existing?._id ?? (await ctx.db.insert("companies", { ...FIRST_COMPANY, ...fromEnv }));
    if (existing) await ctx.db.patch(companyId, fromEnv);

    const secrets = await ctx.db
      .query("companySecrets")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .first();
    if (secrets) await ctx.db.patch(secrets._id, { whatsappToken });
    else await ctx.db.insert("companySecrets", { companyId, whatsappToken });

    for (const [email, role] of add) await ctx.db.insert("members", { companyId, email, role });
    for (const member of change) await ctx.db.patch(member._id, { role: wanted.get(member.email)! });
    for (const member of remove) await ctx.db.delete(member._id);

    return summary;
  },
});

/** Up to `limit` rows of each table that don't have a company yet. */
async function rowsWithoutCompany(ctx: QueryCtx, limit: number) {
  return {
    clients: await ctx.db
      .query("clients")
      .withIndex("by_company_normalized", (q) => q.eq("companyId", undefined))
      .take(limit),
    vehicles: await ctx.db
      .query("vehicles")
      .withIndex("by_company_normalized", (q) => q.eq("companyId", undefined))
      .take(limit),
    deliveries: await ctx.db
      .query("deliveries")
      .withIndex("by_company_delivered", (q) => q.eq("companyId", undefined))
      .take(limit),
    invoiceNumbers: await ctx.db
      .query("invoiceNumbers")
      .withIndex("by_company_number", (q) => q.eq("companyId", undefined))
      .take(limit),
    routes: await ctx.db
      .query("routes")
      .withIndex("by_company", (q) => q.eq("companyId", undefined))
      .take(limit),
    reminders: await ctx.db
      .query("reminders")
      .withIndex("by_company", (q) => q.eq("companyId", undefined))
      .take(limit),
  };
}

/**
 * Gives the first company every row from before it existed, `batch` rows of
 * each table at a time. Keeps going by itself until none is left (see `status`).
 */
export const stampRows = internalMutation({
  args: { batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const companyId = await legacyCompanyId(ctx);
    if (!companyId) throw new Error("Aún no hay empresa: corre primero migrations:backfillCompany.");

    const batch = args.batch ?? 500;
    const rows = await rowsWithoutCompany(ctx, batch);
    const stamped: Record<string, number> = {};
    for (const [table, docs] of Object.entries(rows)) {
      for (const doc of docs) await ctx.db.patch(doc._id, { companyId });
      stamped[table] = docs.length;
    }

    const done = Object.values(rows).every((docs) => docs.length < batch);
    if (!done) await ctx.scheduler.runAfter(0, internal.migrations.stampRows, args);
    return { stamped, done };
  },
});

const STATUS_LIMIT = 1000;

/**
 * What is still missing before the next version can be deployed. `ready` means
 * every row has a company and the members match the access lists.
 */
export const status = internalQuery({
  args: {},
  handler: async (ctx) => {
    const company = await ctx.db.query("companies").first();
    const members = company
      ? await ctx.db
          .query("members")
          .withIndex("by_company", (q) => q.eq("companyId", company._id))
          .collect()
      : [];
    const roles = new Map(members.map((m) => [m.email, m.role]));
    const wanted = rolesFromEnv();

    const rows = await rowsWithoutCompany(ctx, STATUS_LIMIT + 1);
    const withoutCompany = Object.fromEntries(
      Object.entries(rows).map(([table, docs]) => [
        table,
        docs.length > STATUS_LIMIT ? `más de ${STATUS_LIMIT}` : docs.length,
      ]),
    );

    const membersOutOfSync = [
      ...[...wanted]
        .filter(([email]) => !roles.has(email))
        .map(([email, role]) => `${email}: está en las listas (${role}) y no es miembro`),
      ...members
        .filter((m) => !wanted.has(m.email))
        .map((m) => `${m.email}: es miembro (${m.role}) y no está en las listas`),
      ...members
        .filter((m) => wanted.get(m.email) === "admin" && m.role === "driver")
        .map((m) => `${m.email}: es chofer y en las listas es administrador`),
      ...members
        .filter((m) => wanted.get(m.email) === "driver" && m.role !== "driver")
        .map((m) => `${m.email}: es ${m.role} y en las listas es chofer`),
    ].sort();

    return {
      ready:
        company !== null &&
        membersOutOfSync.length === 0 &&
        Object.values(rows).every((docs) => docs.length === 0),
      company: company && { _id: company._id, name: company.name },
      withoutCompany,
      membersOutOfSync,
    };
  },
});
