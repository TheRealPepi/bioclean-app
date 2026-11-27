// @vitest-environment edge-runtime
import { expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DAY_MS, LEGACY_TIME_ZONE, startOfDay } from "./lib/dates";
import { HERE, setup } from "./test.setup";

// With 30 days of credit, a delivery made on May 31 is due on June 30.
const TODAY = "2026-06-30";
const DUE_TODAY = "2026-05-31";
const DUE_IN_A_WEEK = "2026-06-07";
const START = "2026-01-01";

/** The usual setup plus ways to add a credit client and deliveries on a given day. */
async function setupReminders() {
  const base = await setup();
  const { t, driverId, photo } = base;

  const client = (settings: Partial<Doc<"clients">> = {}) =>
    t.run(
      async (ctx) =>
        await ctx.db.insert("clients", {
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
          deliveredAt: startOfDay(day, LEGACY_TIME_ZONE) + DAY_MS / 2,
        }),
    );
  };

  const pending = (start = START) => t.query(internal.reminders.pending, { today: TODAY, start });

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
  const { t, client, delivery, pending } = await setupReminders();
  const clientId = await client();
  const deliveryId = await delivery(clientId, DUE_TODAY, "F-1");
  const [email, whatsapp] = await pending();
  expect([email.channel, whatsapp.channel]).toEqual(["email", "whatsapp"]);

  // What `reminders.run` records after trying to send each message.
  const attempt = ({ clientName: _, ...batch }: typeof email) => batch;
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

test("the daily job does nothing until reminders are turned on, and a dry run sends nothing", async () => {
  const { t, client, delivery } = await setupReminders();
  await delivery(await client(), DUE_TODAY, "F-1");
  const send = vi.fn();
  vi.stubGlobal("fetch", send);

  vi.stubEnv("REMINDERS_START_DATE", "");
  expect(await t.action(internal.reminders.run, { today: TODAY })).toMatchObject({
    status: "apagado",
    batches: [],
  });

  vi.stubEnv("REMINDERS_START_DATE", START);
  const dryRun = await t.action(internal.reminders.run, { today: TODAY, dryRun: true });
  expect(dryRun).toMatchObject({ status: "ok", sent: 0, failed: 0 });
  expect(dryRun.batches).toHaveLength(2);

  expect(send).not.toHaveBeenCalled();
  expect(await t.run(async (ctx) => await ctx.db.query("reminders").collect())).toEqual([]);
});
