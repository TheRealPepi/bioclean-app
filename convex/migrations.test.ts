// @vitest-environment edge-runtime
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ADMIN_EMAIL, DRIVER_EMAIL, HERE, OTHER_DRIVER_EMAIL, setup } from "./test.setup";

const OWNER = { ownerEmail: ADMIN_EMAIL };
const TABLES = ["clients", "vehicles", "deliveries", "invoiceNumbers", "routes", "reminders"] as const;

afterEach(() => {
  vi.useRealTimers();
});

/** The usual setup plus one row in every table that belongs to a company. */
async function setupMigration() {
  const base = await setup();
  const { t, asAdmin, asDriver, driverId, deliveryArgs } = base;

  /** A delivery (with its client and factura), a vehicle, a route and a reminder. */
  const saveOneOfEach = async (name: string) => {
    const deliveryId = await asDriver.mutation(
      api.deliveries.create,
      await deliveryArgs({ clientName: name, invoice: `F-${name}` }),
    );
    const { clientId } = (await t.run((ctx) => ctx.db.get(deliveryId)))!;
    await asAdmin.mutation(api.vehicles.create, { name: `Camioneta ${name}` });
    const routeId = await asAdmin.mutation(api.routes.create, {
      driverId,
      stops: [{ clientId }],
      returnToBase: false,
    });
    await t.mutation(internal.reminders.record, {
      clientId,
      kind: "vencimiento",
      channel: "email",
      to: "pagos@hotel.mx",
      dueDate: "2026-06-30",
      deliveryIds: [deliveryId],
      invoiceNumbers: [`F-${name}`],
    });
    return { clientId, routeId };
  };

  /** The company of every row, table by table. */
  const companies = () =>
    t.run(async (ctx) => {
      const found: Record<string, (Id<"companies"> | undefined)[]> = {};
      for (const table of TABLES) {
        found[table] = (await ctx.db.query(table).collect()).map((row) => row.companyId);
      }
      return found;
    });

  const company = () => t.run(async (ctx) => await ctx.db.query("companies").first());
  const members = () =>
    t.run(async (ctx) =>
      (await ctx.db.query("members").collect())
        .map((m) => `${m.email}: ${m.role}`)
        .sort(),
    );

  return { ...base, saveOneOfEach, companies, company, members };
}

test("the first company is created from what the env vars and the app have today", async () => {
  const { t, asAdmin, asDriver, company, members } = await setupMigration();
  vi.stubEnv("ADMIN_EMAILS", `${ADMIN_EMAIL}, jefa@example.com`);
  vi.stubEnv("REMINDER_FROM_EMAIL", "Bioclean Green Cozumel <avisos@Bioclean.example>");
  vi.stubEnv("REMINDER_REPLY_TO", "oficina@bioclean.example");
  vi.stubEnv("REMINDERS_START_DATE", "2026-01-01");
  vi.stubEnv("WHATSAPP_TOKEN", "secreto");
  vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "1234567890");
  await asAdmin.mutation(api.settings.setBase, { base: HERE });

  // A dry run only says what it would do.
  const plan = await t.mutation(internal.migrations.backfillCompany, { ...OWNER, dryRun: true });
  expect(plan.members.added).toHaveLength(4);
  expect(await company()).toBeNull();
  expect((await asDriver.query(api.users.me))?.company).toBeNull();

  const result = await t.mutation(internal.migrations.backfillCompany, OWNER);
  expect(JSON.stringify(result)).not.toContain("secreto");

  expect(await company()).toMatchObject({
    name: "Bioclean Green Cozumel",
    timeZone: "America/Cancun",
    phoneCountryCode: "52",
    base: HERE,
    senderDomain: "bioclean.example",
    reminders: {
      startDate: "2026-01-01",
      fromName: "Bioclean Green Cozumel",
      fromLocalPart: "avisos",
      replyTo: "oficina@bioclean.example",
      whatsapp: { phoneNumberId: "1234567890" },
    },
  });
  expect(await t.run((ctx) => ctx.db.query("companySecrets").collect())).toMatchObject([
    { whatsappToken: "secreto" },
  ]);
  expect(await members()).toEqual([
    `${OTHER_DRIVER_EMAIL}: driver`,
    `${DRIVER_EMAIL}: driver`,
    "jefa@example.com: admin",
    `${ADMIN_EMAIL}: owner`,
  ]);

  // Access is still decided by the env vars; `me` only starts saying the company.
  expect(await asDriver.query(api.users.me)).toMatchObject({
    role: "driver",
    memberRole: "driver",
    can: ["deliver"],
    company: { name: "Bioclean Green Cozumel", timeZone: "America/Cancun" },
  });
  expect(await asAdmin.query(api.users.me)).toMatchObject({ role: "admin", memberRole: "owner" });
});

test("the owner has to be one of the admins", async () => {
  const { t, company } = await setupMigration();
  await expect(
    t.mutation(internal.migrations.backfillCompany, { ownerEmail: DRIVER_EMAIL }),
  ).rejects.toThrow("no está en ADMIN_EMAILS");
  expect(await company()).toBeNull();
});

test("rows from before the company get it, a batch at a time", async () => {
  const { t, saveOneOfEach, companies, company } = await setupMigration();
  await saveOneOfEach("UNO");
  await saveOneOfEach("DOS");
  await saveOneOfEach("TRES");

  await expect(t.mutation(internal.migrations.stampRows, {})).rejects.toThrow("Aún no hay empresa");
  await t.mutation(internal.migrations.backfillCompany, OWNER);
  expect(await t.query(internal.migrations.status)).toMatchObject({
    ready: false,
    withoutCompany: { clients: 3, vehicles: 3, deliveries: 3, invoiceNumbers: 3, routes: 3, reminders: 3 },
  });

  // Two rows of each table per run: it takes a second run, which it schedules itself.
  vi.useFakeTimers();
  expect(await t.mutation(internal.migrations.stampRows, { batch: 2 })).toMatchObject({ done: false });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const { _id } = (await company())!;
  for (const [table, ids] of Object.entries(await companies())) {
    expect(ids, table).toEqual([_id, _id, _id]);
  }
  expect(await t.query(internal.migrations.status)).toMatchObject({
    ready: true,
    withoutCompany: { clients: 0, vehicles: 0, deliveries: 0, invoiceNumbers: 0, routes: 0, reminders: 0 },
    membersOutOfSync: [],
  });
});

test("everything saved once the company exists already belongs to it", async () => {
  const { t, asAdmin, driverId, saveOneOfEach, companies, company } = await setupMigration();
  await t.mutation(internal.migrations.backfillCompany, OWNER);
  const { _id } = (await company())!;

  const { clientId, routeId } = await saveOneOfEach("UNO");
  // Editing a route rewrites the whole row.
  await asAdmin.mutation(api.routes.update, {
    routeId,
    driverId,
    stops: [{ clientId }],
    returnToBase: true,
  });
  for (const [table, ids] of Object.entries(await companies())) {
    expect(ids, table).toEqual([_id]);
  }

  // The warehouse is kept on the company too.
  await asAdmin.mutation(api.settings.setBase, { base: HERE });
  expect((await company())?.base).toEqual(HERE);
});

test("running it again follows the env vars, so access never differs from them", async () => {
  const { t, members } = await setupMigration();
  await t.mutation(internal.migrations.backfillCompany, OWNER);

  // A driver was removed, another one was made admin, and a new one was added.
  vi.stubEnv("ADMIN_EMAILS", `${ADMIN_EMAIL}, ${DRIVER_EMAIL}`);
  vi.stubEnv("ALLOWED_EMAILS", `${DRIVER_EMAIL}, nuevo@example.com`);
  expect((await t.query(internal.migrations.status)).membersOutOfSync).toEqual([
    `${OTHER_DRIVER_EMAIL}: es miembro (driver) y no está en las listas`,
    `${DRIVER_EMAIL}: es chofer y en las listas es administrador`,
    "nuevo@example.com: está en las listas (driver) y no es miembro",
  ]);

  const result = await t.mutation(internal.migrations.backfillCompany, OWNER);
  expect(result.members).toEqual({
    added: ["nuevo@example.com (driver)"],
    changed: [`${DRIVER_EMAIL} (driver → admin)`],
    removed: [OTHER_DRIVER_EMAIL],
  });
  expect(await members()).toEqual([
    `${DRIVER_EMAIL}: admin`,
    "nuevo@example.com: driver",
    `${ADMIN_EMAIL}: owner`,
  ]);
  expect(await t.run((ctx) => ctx.db.query("companies").collect())).toHaveLength(1);
  expect((await t.query(internal.migrations.status)).ready).toBe(true);
});
