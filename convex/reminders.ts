import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import type { ReminderConfig } from "./companies";
import { getOwned, requireOffice } from "./lib/access";
import { formatIsoLong, isIsoDate, isoDate, localParts, shiftDays } from "./lib/dates";
import { deliveredRange, dueDateFor, reminderDue, WEEK } from "./lib/due";
import { reminderEmailHtml } from "./lib/reminderEmail";
import { reminderChannel, reminderKind } from "./schema";

// Payment reminders for "credito" deliveries: one a week before the payment
// deadline and one on the day. The deadline is the delivery day plus the
// client's credit days. Each company has its own on/off date, sender and time
// zone (`companies.reminders`); `tick` starts `run` for each one every morning.

/** Local hour from which a company's reminders of the day go out. */
const SEND_HOUR = 9;

type Channel = "email" | "whatsapp";
type Kind = "semana_antes" | "vencimiento" | "prueba";

/** One message: every factura of a client with the same deadline. */
type Batch = {
  clientId: Id<"clients">;
  clientName: string;
  kind: Kind;
  channel: Channel;
  to: string;
  dueDate: string;
  deliveryIds: Id<"deliveries">[];
  invoiceNumbers: string[];
};

type RunResult = {
  status: "ok" | "apagado";
  company: string;
  today: string;
  sent: number;
  failed: number;
  batches: Batch[];
};

/** The channels a client has chosen and has contact data for. */
function clientChannels(client: Doc<"clients">): { channel: Channel; to: string }[] {
  const channels: { channel: Channel; to: string }[] = [];
  if (client.notifyBy !== "whatsapp" && client.notifyBy !== undefined && client.email) {
    channels.push({ channel: "email", to: client.email });
  }
  if (client.notifyBy !== "email" && client.notifyBy !== undefined && client.whatsapp) {
    channels.push({ channel: "whatsapp", to: client.whatsapp });
  }
  return channels;
}

/** A company's messages that should go out on `today` for deliveries made since `start`. */
export const pending = internalQuery({
  args: { companyId: v.id("companies"), today: v.string(), start: v.string() },
  handler: async (ctx, { companyId, today, start }): Promise<Batch[]> => {
    const company = await ctx.db.get(companyId); // tenant-ok: internal, for the company it is told
    if (!company) return [];
    const { timeZone } = company;
    const batches = new Map<string, Batch>();

    const clients = await ctx.db
      .query("clients")
      .withIndex("by_company_normalized", (q) => q.eq("companyId", companyId))
      .collect();
    for (const client of clients) {
      const creditDays = client.creditDays;
      const channels = clientChannels(client);
      if (!creditDays || channels.length === 0) continue;

      // Only deliveries whose deadline falls between a few days ago and a week from now.
      const { from, until } = deliveredRange(today, creditDays, start, timeZone);
      if (from >= until) continue;

      const deliveries = await ctx.db
        .query("deliveries")
        .withIndex("by_client", (q) =>
          q.eq("clientId", client._id).gte("deliveredAt", from).lt("deliveredAt", until),
        )
        .collect();

      for (const delivery of deliveries) {
        if (delivery.payment !== "credito" || delivery.deliveredAt === undefined) continue;

        const dueDate = dueDateFor(delivery.deliveredAt, creditDays, timeZone);
        const kind = reminderDue(today, dueDate, creditDays);
        if (kind === null) continue;

        const numbers = delivery.invoices?.map((i) => i.number) ?? [delivery.invoiceNumber];
        for (const { channel, to } of channels) {
          if (delivery.reminded?.includes(`${kind}:${channel}`)) continue;
          const key = `${client._id}:${kind}:${channel}:${dueDate}`;
          const batch = batches.get(key) ?? {
            clientId: client._id,
            clientName: client.name,
            kind,
            channel,
            to,
            dueDate,
            deliveryIds: [],
            invoiceNumbers: [],
          };
          batch.deliveryIds.push(delivery._id);
          batch.invoiceNumbers.push(...numbers);
          batches.set(key, batch);
        }
      }
    }

    return [...batches.values()];
  },
});

/** Logs a message and, if it was sent, marks its deliveries so it isn't sent again. */
export const record = internalMutation({
  args: {
    companyId: v.id("companies"),
    clientId: v.id("clients"),
    kind: reminderKind,
    channel: reminderChannel,
    to: v.string(),
    dueDate: v.string(),
    deliveryIds: v.array(v.id("deliveries")),
    invoiceNumbers: v.array(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { error, companyId, ...batch }) => {
    if (error === undefined) {
      const marker = `${batch.kind}:${batch.channel}`;
      for (const id of batch.deliveryIds) {
        const delivery = await getOwned(ctx, companyId, id);
        if (!delivery || delivery.reminded?.includes(marker)) continue;
        await ctx.db.patch(id, { reminded: [...(delivery.reminded ?? []), marker] });
      }
    }
    // The client may have been merged into another one while the message was being sent.
    if ((await getOwned(ctx, companyId, batch.clientId)) === null) return;
    await ctx.db.insert("reminders", {
      companyId,
      ...batch,
      status: error === undefined ? "enviado" : "error",
      error,
    });
  },
});

/** What a message says; the rest of a batch is about where it goes and what it marks. */
type Message = Pick<Batch, "clientName" | "kind" | "to" | "dueDate" | "invoiceNumbers">;

function messageText(batch: Message) {
  const date = formatIsoLong(batch.dueDate);
  const many = batch.invoiceNumbers.length > 1;
  const intro =
    batch.kind === "vencimiento"
      ? `Le recordamos que ${
          many ? "las siguientes facturas tienen" : "la siguiente factura tiene"
        } como fecha límite de pago el ${date}:`
      : `Le recordamos que el pago de ${
          many ? "las siguientes facturas" : "la siguiente factura"
        } vence el ${date}:`;
  const subject =
    (batch.kind === "prueba" ? "[Prueba] " : "") +
    (batch.kind === "vencimiento"
      ? `Recordatorio de pago: fecha límite ${date}`
      : `Recordatorio de pago: vence el ${date}`);
  return { date, intro, subject };
}

async function sendEmail(batch: Message, config: ReminderConfig) {
  const { sender, companyName } = config;
  if ("error" in sender) throw new Error(sender.error);
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Falta configurar RESEND_API_KEY en Convex.");
  const { date, intro, subject } = messageText(batch);
  const closing = "Si ya realizó el pago, por favor haga caso omiso de este mensaje.";
  const text = [
    `Estimado cliente ${batch.clientName}:`,
    "",
    intro,
    ...batch.invoiceNumbers.map((n) => `- Factura ${n}`),
    "",
    closing,
    "",
    "Gracias,",
    companyName,
  ].join("\n");
  const html = reminderEmailHtml({
    company: companyName,
    tagline: config.tagline,
    clientName: batch.clientName,
    intro,
    date,
    invoiceNumbers: batch.invoiceNumbers,
    closing,
  });

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: sender.from,
      to: [batch.to],
      subject,
      text,
      html,
      ...(sender.replyTo ? { reply_to: sender.replyTo } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

/**
 * WhatsApp only lets a business start a conversation with a template approved
 * by Meta. Both templates take three body variables: client name, factura
 * numbers and the payment deadline (see the README for their text).
 */
async function sendWhatsApp(batch: Batch, { whatsapp }: ReminderConfig) {
  if (!whatsapp) {
    throw new Error(
      "Falta configurar WhatsApp en Configuración › Recordatorios (el identificador del número y el token).",
    );
  }
  const { token, phoneNumberId } = whatsapp;
  const version = process.env.WHATSAPP_API_VERSION || "v26.0";
  const template =
    batch.kind === "vencimiento" ? whatsapp.templateVencimiento : whatsapp.templateProximo;

  // Template variables can't have line breaks, and the whole message has a length limit.
  let invoices = batch.invoiceNumbers.join(", ");
  if (invoices.length > 500) invoices = `${invoices.slice(0, 500)}… y otras`;
  const parameters = [batch.clientName, invoices, formatIsoLong(batch.dueDate)].map((text) => ({
    type: "text",
    text: text.replace(/\s+/g, " "),
  }));

  const response = await fetch(`https://graph.facebook.com/${version}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: batch.to,
      type: "template",
      template: {
        name: template,
        language: { code: whatsapp.lang },
        components: [{ type: "body", parameters }],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`WhatsApp respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

/** Sends each message and logs the result. A failure never stops the rest. */
async function deliver(
  ctx: ActionCtx,
  companyId: Id<"companies">,
  config: ReminderConfig,
  batches: Batch[],
) {
  let sent = 0;
  let failed = 0;
  for (const batch of batches) {
    let error: string | undefined;
    try {
      if (batch.channel === "email") await sendEmail(batch, config);
      else await sendWhatsApp(batch, config);
      sent++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      failed++;
    }
    // The log row doesn't keep the client's name (it follows renames through clientId).
    const { clientName: _clientName, ...row } = batch;
    await ctx.runMutation(internal.reminders.record, { companyId, ...row, error });
  }
  return { sent, failed };
}

async function configOf(ctx: ActionCtx, companyId: Id<"companies">): Promise<ReminderConfig> {
  const config = await ctx.runQuery(internal.companies.reminderConfig, { companyId });
  if (!config) throw new Error("Esa empresa no existe.");
  return config;
}

/**
 * Sends a company's reminders of the day. Does nothing until the company sets
 * the day reminders start (Configuración › Recordatorios): only deliveries made
 * from that day on get them.
 *
 * To see what would be sent without sending it:
 * `npx convex run reminders:run '{"companyId": "…", "dryRun": true}'` (and
 * `"today": "2026-12-01"` to try another day). `npx convex run companies:list`
 * gives the ids.
 */
export const run = internalAction({
  args: {
    companyId: v.id("companies"),
    today: v.optional(v.string()),
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, { companyId, dryRun, ...args }): Promise<RunResult> => {
    const config = await configOf(ctx, companyId);
    const company = config.companyName;
    const today = args.today ?? isoDate(Date.now(), config.timeZone);
    if (!isIsoDate(today)) throw new Error(`Fecha inválida: ${today}`);

    const start = config.startDate;
    if (!start) return { status: "apagado", company, today, sent: 0, failed: 0, batches: [] };

    const batches: Batch[] = await ctx.runQuery(internal.reminders.pending, {
      companyId,
      today,
      start,
    });
    if (dryRun) return { status: "ok", company, today, sent: 0, failed: 0, batches };
    const result = await deliver(ctx, companyId, config, batches);
    return { status: "ok", company, today, ...result, batches };
  },
});

/**
 * Every hour (see `crons.ts`): starts the reminders of each company that has
 * them on, once a day, when it's morning there.
 */
export const tick = internalMutation({
  // `now` is only passed by tests.
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const started: string[] = [];
    // tenant-ok: the job is for every company.
    for (const company of await ctx.db.query("companies").collect()) {
      if (!company.reminders?.startDate) continue;
      const today = isoDate(now, company.timeZone);
      if (localParts(now, company.timeZone).hours < SEND_HOUR) continue;
      if (company.remindersLastRunOn === today) continue;
      await ctx.db.patch(company._id, { remindersLastRunOn: today });
      await ctx.scheduler.runAfter(0, internal.reminders.run, { companyId: company._id, today });
      started.push(company.name);
    }
    return { started };
  },
});

/** A sample message per channel of the client, to check their contact data. */
export const testBatches = internalQuery({
  args: { companyId: v.id("companies"), clientId: v.id("clients") },
  handler: async (ctx, { companyId, clientId }): Promise<Batch[]> => {
    const company = await ctx.db.get(companyId); // tenant-ok: internal, for the company it is told
    const client = await getOwned(ctx, companyId, clientId);
    if (!company || !client) return [];
    return clientChannels(client).map(({ channel, to }) => ({
      clientId,
      clientName: client.name,
      kind: "prueba",
      channel,
      to,
      dueDate: shiftDays(isoDate(Date.now(), company.timeZone), WEEK),
      deliveryIds: [],
      invoiceNumbers: ["PRUEBA-001"],
    }));
  },
});

export const deliverTest = internalAction({
  args: { companyId: v.id("companies"), clientId: v.id("clients") },
  handler: async (ctx, args): Promise<void> => {
    const config = await configOf(ctx, args.companyId);
    const batches: Batch[] = await ctx.runQuery(internal.reminders.testBatches, args);
    await deliver(ctx, args.companyId, config, batches);
  },
});

/** Office button "Enviar prueba". The result shows up in `listForClient`. */
export const sendTest = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const { companyId } = await requireOffice(ctx);
    const client = await getOwned(ctx, companyId, clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    if (clientChannels(client).length === 0) {
      throw new ConvexError("Primero elige por dónde avisarle y guarda sus datos de contacto.");
    }
    await ctx.scheduler.runAfter(0, internal.reminders.deliverTest, { companyId, clientId });
  },
});

/**
 * Settings button "Enviarme una prueba": a sample reminder email to the admin's
 * own address, to check the company's sender. Fails with what went wrong.
 */
export const testSender = action({
  args: {},
  handler: async (ctx): Promise<{ to: string }> => {
    // guard: `viewerReminderConfig` only answers an owner or admin, about their own company.
    const { to, config } = await ctx.runQuery(internal.companies.viewerReminderConfig, {});
    const sample: Message = {
      clientName: "CLIENTE DE EJEMPLO",
      kind: "prueba",
      to,
      dueDate: shiftDays(isoDate(Date.now(), config.timeZone), WEEK),
      invoiceNumbers: ["PRUEBA-001"],
    };
    try {
      await sendEmail(sample, config);
    } catch (e) {
      throw new ConvexError(e instanceof Error ? e.message : String(e));
    }
    return { to };
  },
});

/** The latest reminders of a client, newest first. */
export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const { companyId } = await requireOffice(ctx);
    if (!(await getOwned(ctx, companyId, clientId))) return [];
    const rows = await ctx.db
      .query("reminders")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .order("desc")
      .take(8);
    return rows.map((r) => ({
      _id: r._id,
      sentAt: r._creationTime,
      kind: r.kind,
      channel: r.channel,
      to: r.to,
      dueDate: r.dueDate,
      invoiceNumbers: r.invoiceNumbers,
      status: r.status,
      error: r.error ?? null,
    }));
  },
});
