// @vitest-environment edge-runtime
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DAY_MS, startOfDay } from "./lib/dates";
import { HERE, setup } from "./test.setup";

// With 30 days of credit, a delivery made on May 31 is due on June 30.
const TODAY = "2026-06-30";
const DUE_TODAY = "2026-05-31";
const DUE_IN_A_WEEK = "2026-06-07";
const START = "2026-01-01";
// The zone of the first company of the setup.
const ZONE = "America/Cancun";

afterEach(() => {
  vi.useRealTimers();
});

/** The usual setup plus ways to add a credit client and deliveries on a given day. */
async function setupReminders() {
  const base = await setup();
  const { t, companyId, driverId, photo } = base;

  const client = (settings: Partial<Doc<"clients">> = {}) =>
    t.run(
      async (ctx) =>
        await ctx.db.insert("clients", {
          companyId,
          name: "HOTEL COZUMEL",
          normalizedName: "HOTEL COZUMEL",
          deliveryCount: 0,
          email: "pagos@hotel.mx",
          whatsapp: "529871234567",
          creditDays: 30,
          notifyBy: "ambos",
          ...settings,
        }),
    );

  const delivery = async (
    clientId: Id<"clients">,
    day: string,
    number: string,
    payment: "credito" | "pagado" = "credito",
  ) => {
    const photoId = await photo();
    return await t.run(
      async (ctx) =>
        await ctx.db.insert("deliveries", {
          companyId,
          clientId,
          clientName: "HOTEL COZUMEL",
          invoiceNumber: number,
          invoices: [{ number, photoId }],
          receiverPhotoId: photoId,
          goodsPhotoId: photoId,
          location: HERE,
          status: "exitosa",
          notes: "",
          driverId,
          driverName: "Chofer Uno",
          payment,
          deliveredAt: startOfDay(day, ZONE) + DAY_MS / 2,
        }),
    );
  };

  const pending = (start = START) =>
    t.query(internal.reminders.pending, { companyId, today: TODAY, start });

  return { ...base, client, delivery, pending };
}

test("a credit delivery due today gets one message per channel the client chose", async () => {
  const { client, delivery, pending } = await setupReminders();
  const clientId = await client();
  const deliveryId = await delivery(clientId, DUE_TODAY, "F-1");

  const batches = await pending();

  expect(batches).toHaveLength(2);
  expect(batches).toContainEqual({
    clientId,
    clientName: "HOTEL COZUMEL",
    kind: "vencimiento",
    channel: "email",
    to: "pagos@hotel.mx",
    dueDate: TODAY,
    deliveryIds: [deliveryId],
    invoiceNumbers: ["F-1"],
  });
  expect(batches).toContainEqual(
    expect.objectContaining({ channel: "whatsapp", to: "529871234567", kind: "vencimiento" }),
  );
});

test("no reminder for paid deliveries, clients without reminders, or old deliveries", async () => {
  const { client, delivery, pending } = await setupReminders();

  await delivery(await client(), DUE_TODAY, "F-1", "pagado");
  await delivery(await client({ notifyBy: undefined }), DUE_TODAY, "F-2");
  await delivery(await client({ creditDays: undefined }), DUE_TODAY, "F-3");
  // Chose WhatsApp but has no number.
  await delivery(await client({ notifyBy: "whatsapp", whatsapp: undefined }), DUE_TODAY, "F-4");
  expect(await pending()).toEqual([]);

  // Reminders were turned on after this one was delivered.
  await delivery(await client(), DUE_TODAY, "F-5");
  expect(await pending("2026-06-01")).toEqual([]);
  expect(await pending()).toHaveLength(2);
});

test("a client's facturas with the same deadline go in one message", async () => {
  const { client, delivery, pending } = await setupReminders();
  const clientId = await client({ notifyBy: "email" });
  await delivery(clientId, DUE_TODAY, "F-1");
  await delivery(clientId, DUE_TODAY, "F-2");
  await delivery(clientId, DUE_IN_A_WEEK, "F-3");

  const batches = await pending();

  expect(batches.map((b) => [b.kind, b.dueDate, b.invoiceNumbers])).toEqual([
    ["vencimiento", TODAY, ["F-1", "F-2"]],
    ["semana_antes", "2026-07-07", ["F-3"]],
  ]);
});

test("a reminder that was sent is never sent again, and one that failed is retried", async () => {
  const { t, companyId, client, delivery, pending } = await setupReminders();
  const clientId = await client();
  const deliveryId = await delivery(clientId, DUE_TODAY, "F-1");
  const [email, whatsapp] = await pending();
  expect([email.channel, whatsapp.channel]).toEqual(["email", "whatsapp"]);

  // What `reminders.run` records after trying to send each message.
  const attempt = ({ clientName: _, ...batch }: typeof email) => ({ companyId, ...batch });
  await t.mutation(internal.reminders.record, attempt(email));
  await t.mutation(internal.reminders.record, { ...attempt(whatsapp), error: "Sin conexión" });

  expect((await t.run(async (ctx) => await ctx.db.get(deliveryId)))!.reminded).toEqual([
    "vencimiento:email",
  ]);
  expect((await pending()).map((b) => b.channel)).toEqual(["whatsapp"]);
  // Both attempts are in the log the office sees.
  const log = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
  expect(log.map((r) => [r.channel, r.status, r.error])).toEqual([
    ["email", "enviado", undefined],
    ["whatsapp", "error", "Sin conexión"],
  ]);

  // Marking the delivery as paid stops what was still pending.
  await t.run(async (ctx) => await ctx.db.patch(deliveryId, { payment: "pagado" }));
  expect(await pending()).toEqual([]);
});

test("the daily job does nothing until the company turns reminders on, and a dry run sends nothing", async () => {
  const { t, companyId, client, delivery } = await setupReminders();
  await delivery(await client(), DUE_TODAY, "F-1");
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  const run = (dryRun?: boolean) =>
    t.action(internal.reminders.run, { companyId, today: TODAY, dryRun });

  expect(await run()).toMatchObject({ status: "apagado", batches: [] });

  await t.run(async (ctx) => await ctx.db.patch(companyId, { reminders: { startDate: START } }));
  const dryRun = await run(true);
  expect(dryRun).toMatchObject({
    status: "ok",
    company: "Bioclean Green Cozumel",
    sent: 0,
    failed: 0,
  });
  expect(dryRun.batches).toHaveLength(2);

  expect(send).not.toHaveBeenCalled();
  expect(await t.run(async (ctx) => await ctx.db.query("reminders").collect())).toEqual([]);
});

test("the messages go out with the company's own sender and WhatsApp number", async () => {
  const { t, companyId, asAdmin, client, delivery } = await setupReminders();
  await delivery(await client(), DUE_TODAY, "F-1");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  const send = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", send);

  await t.mutation(internal.companies.setSenderDomain, { companyId, senderDomain: "bioclean.example" });
  await asAdmin.mutation(api.companies.updateReminders, {
    startDate: START,
    fromName: "",
    fromLocalPart: "cobranza",
    replyTo: "oficina@bioclean.example",
    whatsapp: { phoneNumberId: "1234567890", templateVencimiento: "aviso_hoy", templateProximo: "", lang: "" },
  });
  await asAdmin.mutation(api.companies.setWhatsAppToken, { token: "EAAG-un-token-largo-de-meta" });

  expect(await t.action(internal.reminders.run, { companyId, today: TODAY })).toMatchObject({
    status: "ok",
    sent: 2,
    failed: 0,
  });

  const calls = send.mock.calls.map(([url, init]) => ({
    url,
    authorization: (init.headers as Record<string, string>).Authorization,
    body: JSON.parse(init.body as string),
  }));
  expect(calls).toMatchObject([
    {
      url: "https://api.resend.com/emails",
      authorization: "Bearer re_test",
      body: {
        from: '"Bioclean Green Cozumel" <cobranza@bioclean.example>',
        reply_to: "oficina@bioclean.example",
        to: ["pagos@hotel.mx"],
      },
    },
    {
      url: expect.stringContaining("/1234567890/messages"),
      authorization: "Bearer EAAG-un-token-largo-de-meta",
      body: { to: "529871234567", template: { name: "aviso_hoy", language: { code: "es_MX" } } },
    },
  ]);
  const log = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
  expect(log.map((r) => [r.companyId, r.channel, r.status])).toEqual([
    [companyId, "email", "enviado"],
    [companyId, "whatsapp", "enviado"],
  ]);
});

test("a channel the company hasn't set up fails in the log without stopping the other", async () => {
  const { t, companyId, client, delivery } = await setupReminders();
  await delivery(await client(), DUE_TODAY, "F-1");
  vi.stubEnv("RESEND_API_KEY", "re_test");
  vi.stubEnv("REMINDER_DEFAULT_FROM_EMAIL", "avisos@deliverado.example");
  const send = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", send);
  // On the shared address, with a reply-to; no WhatsApp.
  await t.run(
    async (ctx) =>
      await ctx.db.patch(companyId, {
        reminders: { startDate: START, replyTo: "oficina@bioclean.example" },
      }),
  );

  expect(await t.action(internal.reminders.run, { companyId, today: TODAY })).toMatchObject({
    sent: 1,
    failed: 1,
  });
  expect(send).toHaveBeenCalledOnce();
  expect(JSON.parse(send.mock.calls[0][1].body as string).from).toBe(
    '"Bioclean Green Cozumel" <avisos@deliverado.example>',
  );
  const log = await t.run(async (ctx) => await ctx.db.query("reminders").collect());
  expect(log.map((r) => [r.channel, r.status])).toEqual([
    ["email", "enviado"],
    ["whatsapp", "error"],
  ]);
  expect(log[1].error).toContain("Falta configurar WhatsApp");
});

test("each company's reminders start once a day, in the morning of its own time zone", async () => {
  vi.useFakeTimers();
  const { t, companyId, otherCompanyId } = await setupReminders();
  const lastRun = async () =>
    await t.run(async (ctx) => [
      (await ctx.db.get(companyId))!.remindersLastRunOn,
      (await ctx.db.get(otherCompanyId))!.remindersLastRunOn,
    ]);
  /** What the hourly job starts at that time (UTC). */
  const tickAt = async (time: string) => {
    const { started } = await t.mutation(internal.reminders.tick, { now: Date.parse(time) });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    return started;
  };

  // Nobody has turned reminders on.
  expect(await tickAt("2026-06-30T20:00:00Z")).toEqual([]);

  await t.run(async (ctx) => {
    await ctx.db.patch(companyId, { reminders: { startDate: START } });
    await ctx.db.patch(otherCompanyId, { reminders: { startDate: START } });
  });
  // 9:00 a.m. is 14:00 UTC in Cozumel and, in summer, 16:00 UTC in Tijuana.
  expect(await tickAt("2026-07-01T13:00:00Z")).toEqual([]);
  expect(await tickAt("2026-07-01T14:00:00Z")).toEqual(["Bioclean Green Cozumel"]);
  expect(await tickAt("2026-07-01T15:00:00Z")).toEqual([]);
  expect(await tickAt("2026-07-01T16:00:00Z")).toEqual(["Limpieza Rival"]);
  expect(await tickAt("2026-07-01T23:00:00Z")).toEqual([]);
  expect(await lastRun()).toEqual(["2026-07-01", "2026-07-01"]);

  // The next morning, each one again. It's still July 1 in Tijuana at 05:00 UTC.
  expect(await tickAt("2026-07-02T05:00:00Z")).toEqual([]);
  expect(await tickAt("2026-07-02T14:30:00Z")).toEqual(["Bioclean Green Cozumel"]);
  // An hour the job missed is made up for later the same day.
  expect(await tickAt("2026-07-02T21:00:00Z")).toEqual(["Limpieza Rival"]);
  expect(await lastRun()).toEqual(["2026-07-02", "2026-07-02"]);

  // In winter Tijuana is an hour further from UTC.
  expect(await tickAt("2026-12-01T16:00:00Z")).toEqual(["Bioclean Green Cozumel"]);
  expect(await tickAt("2026-12-01T17:00:00Z")).toEqual(["Limpieza Rival"]);
});
