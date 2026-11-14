import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
} from "./_generated/server";
import { requireAdmin } from "./lib/access";
import { formatIsoLong, isIsoDate, isoDate, shiftDays } from "./lib/dates";
import { deliveredRange, dueDateFor, reminderDue, WEEK } from "./lib/due";
import { reminderEmailHtml } from "./lib/reminderEmail";
import { reminderChannel, reminderKind } from "./schema";

// Payment reminders for "credito" deliveries: one a week before the payment
// deadline and one on the day. The deadline is the delivery day plus the
// client's credit days. `run` is called every morning by convex/crons.ts.

const COMPANY = "Bioclean Green Cozumel";

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

/** Messages that should go out on `today` for deliveries made since `start`. */
export const pending = internalQuery({
  args: { today: v.string(), start: v.string() },
  handler: async (ctx, { today, start }): Promise<Batch[]> => {
    const batches = new Map<string, Batch>();

    for (const client of await ctx.db.query("clients").collect()) {
      const creditDays = client.creditDays;
      const channels = clientChannels(client);
      if (!creditDays || channels.length === 0) continue;

      // Only deliveries whose deadline falls between a few days ago and a week from now.
      const { from, until } = deliveredRange(today, creditDays, start);
      if (from >= until) continue;

      const deliveries = await ctx.db
        .query("deliveries")
        .withIndex("by_client", (q) =>
          q.eq("clientId", client._id).gte("deliveredAt", from).lt("deliveredAt", until),
        )
        .collect();

      for (const delivery of deliveries) {
        if (delivery.payment !== "credito" || delivery.deliveredAt === undefined) continue;

        const dueDate = dueDateFor(delivery.deliveredAt, creditDays);
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
    clientId: v.id("clients"),
    kind: reminderKind,
    channel: reminderChannel,
    to: v.string(),
    dueDate: v.string(),
    deliveryIds: v.array(v.id("deliveries")),
    invoiceNumbers: v.array(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { error, ...batch }) => {
    if (error === undefined) {
      const marker = `${batch.kind}:${batch.channel}`;
      for (const id of batch.deliveryIds) {
        const delivery = await ctx.db.get(id);
        if (!delivery || delivery.reminded?.includes(marker)) continue;
        await ctx.db.patch(id, { reminded: [...(delivery.reminded ?? []), marker] });
      }
    }
    // The client may have been merged into another one while the message was being sent.
    if ((await ctx.db.get(batch.clientId)) === null) return;
    await ctx.db.insert("reminders", {
      ...batch,
      status: error === undefined ? "enviado" : "error",
      error,
    });
  },
});

function messageText(batch: Batch) {
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

async function sendEmail(batch: Batch) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.REMINDER_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Falta configurar RESEND_API_KEY y REMINDER_FROM_EMAIL en Convex.");
  }
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
    COMPANY,
  ].join("\n");
  const html = reminderEmailHtml({
    company: COMPANY,
    clientName: batch.clientName,
    intro,
    date,
    invoiceNumbers: batch.invoiceNumbers,
    closing,
  });

  const replyTo = process.env.REMINDER_REPLY_TO;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [batch.to],
      subject,
      text,
      html,
      ...(replyTo ? { reply_to: replyTo } : {}),
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
async function sendWhatsApp(batch: Batch) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    throw new Error("Falta configurar WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID en Convex.");
  }
  const version = process.env.WHATSAPP_API_VERSION || "v26.0";
  const template =
    batch.kind === "vencimiento"
      ? process.env.WHATSAPP_TEMPLATE_VENCIMIENTO || "recordatorio_pago_vencimiento"
      : process.env.WHATSAPP_TEMPLATE_PROXIMO || "recordatorio_pago_proximo";

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
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "es_MX" },
        components: [{ type: "body", parameters }],
      },
    }),
  });
  if (!response.ok) {
    throw new Error(`WhatsApp respondió ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
}

/** Sends each message and logs the result. A failure never stops the rest. */
async function deliver(ctx: ActionCtx, batches: Batch[]) {
  let sent = 0;
  let failed = 0;
  for (const batch of batches) {
    let error: string | undefined;
    try {
      if (batch.channel === "email") await sendEmail(batch);
      else await sendWhatsApp(batch);
      sent++;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      failed++;
    }
    // The log row doesn't keep the client's name (it follows renames through clientId).
    const { clientName: _clientName, ...row } = batch;
    await ctx.runMutation(internal.reminders.record, { ...row, error });
  }
  return { sent, failed };
}

/**
 * Sends today's reminders. Does nothing until REMINDERS_START_DATE
 * ("YYYY-MM-DD") is set in Convex: only deliveries made from that day on get
 * reminders.
 *
 * To see what would be sent without sending it:
 * `npx convex run reminders:run '{"dryRun": true}'` (and `"today": "2026-12-01"`
 * to try another day).
 */
export const run = internalAction({
  args: { today: v.optional(v.string()), dryRun: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<RunResult> => {
    const today = args.today ?? isoDate();
    if (!isIsoDate(today)) throw new Error(`Fecha inválida: ${today}`);

    const start = process.env.REMINDERS_START_DATE?.trim();
    if (!start) return { status: "apagado", today, sent: 0, failed: 0, batches: [] };
    if (!isIsoDate(start)) {
      throw new Error(`REMINDERS_START_DATE debe tener el formato AAAA-MM-DD (tiene "${start}").`);
    }

    const batches: Batch[] = await ctx.runQuery(internal.reminders.pending, { today, start });
    if (args.dryRun) return { status: "ok", today, sent: 0, failed: 0, batches };
    return { status: "ok", today, ...(await deliver(ctx, batches)), batches };
  },
});

/** A sample message per channel of the client, to check their contact data. */
export const testBatches = internalQuery({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }): Promise<Batch[]> => {
    const client = await ctx.db.get(clientId);
    if (!client) return [];
    return clientChannels(client).map(({ channel, to }) => ({
      clientId,
      clientName: client.name,
      kind: "prueba",
      channel,
      to,
      dueDate: shiftDays(isoDate(), WEEK),
      deliveryIds: [],
      invoiceNumbers: ["PRUEBA-001"],
    }));
  },
});

export const deliverTest = internalAction({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }): Promise<void> => {
    const batches: Batch[] = await ctx.runQuery(internal.reminders.testBatches, { clientId });
    await deliver(ctx, batches);
  },
});

/** Admin button "Enviar prueba". The result shows up in `listForClient`. */
export const sendTest = mutation({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireAdmin(ctx);
    const client = await ctx.db.get(clientId);
    if (!client) throw new ConvexError("El cliente ya no existe.");
    if (clientChannels(client).length === 0) {
      throw new ConvexError("Primero elige por dónde avisarle y guarda sus datos de contacto.");
    }
    await ctx.scheduler.runAfter(0, internal.reminders.deliverTest, { clientId });
  },
});

/** The latest reminders of a client, newest first. */
export const listForClient = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await requireAdmin(ctx);
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
