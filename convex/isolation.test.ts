// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { isoDate, shiftDays } from "./lib/dates";
import { DRIVER_EMAIL, FAR, HERE, setup } from "./test.setup";

// Two companies that use the app the same way: the same client name, factura
// number and vehicle name. Nothing one of them does can show or change what
// belongs to the other.

const ANY_TIME = { from: 0, to: Number.MAX_SAFE_INTEGER };
const TABLES = ["clients", "vehicles", "deliveries", "invoiceNumbers", "routes", "reminders", "members"] as const;

async function setupTwoCompanies() {
  const base = await setup();
  const { t, companyId, otherCompanyId, driverId, rivalDriverId, deliveryArgs } = base;
  const { asAdmin, asDriver, asRivalAdmin, asRivalDriver } = base;

  /** A vehicle, a credit delivery to "Hotel Cozumel", a route to it and a reminder in its log. */
  const work = async (
    office: typeof asAdmin,
    driver: typeof asDriver,
    ids: { companyId: Id<"companies">; driverId: Id<"users"> },
  ) => {
    const vehicleId = await office.mutation(api.vehicles.create, { name: "Camioneta 1" });
    const deliveryId = await driver.mutation(
      api.deliveries.create,
      await deliveryArgs({ invoice: "F-1", vehicleId, payment: "credito", clientRequestId: "phone-1" }),
    );
    const { clientId } = (await t.run(async (ctx) => await ctx.db.get(deliveryId)))!;
    await office.mutation(api.clients.updateBilling, {
      clientId,
      email: "pagos@hotel.mx",
      whatsapp: "",
      creditDays: 30,
      notifyBy: "email",
    });
    await office.mutation(api.settings.setBase, { base: HERE });
    const routeId = await office.mutation(api.routes.create, {
      driverId: ids.driverId,
      stops: [{ clientId }],
      returnToBase: false,
    });
    await t.mutation(internal.reminders.record, {
      companyId: ids.companyId,
      clientId,
      kind: "vencimiento",
      channel: "email",
      to: "pagos@hotel.mx",
      dueDate: "2026-06-30",
      deliveryIds: [deliveryId],
      invoiceNumbers: ["F-1"],
    });
    return { companyId: ids.companyId, vehicleId, deliveryId, clientId, routeId };
  };

  const ours = await work(asAdmin, asDriver, { companyId, driverId });
  const theirs = await work(asRivalAdmin, asRivalDriver, {
    companyId: otherCompanyId,
    driverId: rivalDriverId,
  });

  /** Every row of a company, to check later that nothing changed. */
  const everythingOf = (id: Id<"companies">) =>
    t.run(async (ctx) => {
      const rows: Record<string, unknown[]> = { company: [await ctx.db.get(id)] };
      for (const table of TABLES) {
        rows[table] = (await ctx.db.query(table).collect()).filter((row) => row.companyId === id);
      }
      return rows;
    });

  return { ...base, ours, theirs, everythingOf };
}

test("two companies with the same client, factura and vehicle names each see only their own", async () => {
  const { asAdmin, asDriver, asRivalAdmin, asRivalDriver, ours, theirs, everythingOf, companyId, otherCompanyId } =
    await setupTwoCompanies();

  const seenBy = async (office: typeof asAdmin, driver: typeof asDriver) => ({
    clients: (await driver.query(api.clients.list, {})).map((c) => c._id),
    clientsAdmin: (await office.query(api.clients.listAdmin, {})).map((c) => c._id),
    vehicles: (await driver.query(api.vehicles.list, {})).map((v) => v._id),
    deliveries: (await office.query(api.deliveries.list, ANY_TIME)).map((d) => d._id),
    mine: (await driver.query(api.deliveries.listMine, { since: 0 })).map((d) => d._id),
    routes: (await office.query(api.routes.listAdmin, {})).map((r) => r._id),
    myRoutes: (await driver.query(api.routes.listMine, {})).map((r) => r._id),
    drivers: (await office.query(api.users.listDrivers, {})).drivers.map((d) => d.name),
    reminders: await office.query(api.reminders.listForClient, { clientId: ours.clientId }),
  });

  expect(await seenBy(asAdmin, asDriver)).toMatchObject({
    clients: [ours.clientId],
    clientsAdmin: [ours.clientId],
    vehicles: [ours.vehicleId],
    deliveries: [ours.deliveryId],
    mine: [ours.deliveryId],
    routes: [ours.routeId],
    myRoutes: [ours.routeId],
    drivers: ["Chofer Dos", "Chofer Uno"],
    reminders: [{ to: "pagos@hotel.mx" }],
  });
  expect(await seenBy(asRivalAdmin, asRivalDriver)).toEqual({
    clients: [theirs.clientId],
    clientsAdmin: [theirs.clientId],
    vehicles: [theirs.vehicleId],
    deliveries: [theirs.deliveryId],
    mine: [theirs.deliveryId],
    routes: [theirs.routeId],
    myRoutes: [theirs.routeId],
    drivers: ["Chofer Rival"],
    // Our client's reminder log, asked by them.
    reminders: [],
  });

  // The same factura number in the other company isn't a repeat, and the
  // wizard only asks about the company's own earlier deliveries.
  const [theirDelivery] = await asRivalAdmin.query(api.deliveries.list, ANY_TIME);
  expect(theirDelivery.repeat).toBeNull();
  const [found] = await asRivalDriver.query(api.deliveries.findByInvoices, { numbers: ["F-1"] });
  expect(found.earlier).toHaveLength(1);
  expect(found.earlier[0].driverName).toBe("Chofer Rival");
  expect(await asRivalDriver.query(api.deliveries.findByInvoice, { invoiceNumber: "F-9" })).toBeNull();

  // Each company's rows carry its id, the vehicle and client included.
  const mine = await everythingOf(companyId);
  const others = await everythingOf(otherCompanyId);
  for (const table of ["clients", "vehicles", "deliveries", "invoiceNumbers", "routes", "reminders"]) {
    expect(mine[table], table).toHaveLength(1);
    expect(others[table], table).toHaveLength(1);
  }
});

test("another company's ids behave like ones that don't exist, and nothing of ours changes", async () => {
  const { t, asAdmin, asRivalAdmin, asRivalDriver, driverId, ours, theirs, everythingOf, deliveryArgs } =
    await setupTwoCompanies();
  const { companyId } = ours;
  const ourMember = (await asAdmin.query(api.members.list, {})).find((m) => m.email === DRIVER_EMAIL)!;
  const before = await everythingOf(companyId);
  const rival = asRivalAdmin;

  // Reading.
  expect(await rival.query(api.deliveries.get, { id: ours.deliveryId })).toBeNull();
  expect(await asRivalDriver.query(api.deliveries.get, { id: ours.deliveryId })).toBeNull();
  expect(await rival.query(api.reminders.listForClient, { clientId: ours.clientId })).toEqual([]);

  // Clients.
  const gone = "El cliente ya no existe";
  await expect(rival.mutation(api.clients.rename, { clientId: ours.clientId, name: "X" })).rejects.toThrow(gone);
  await expect(
    rival.mutation(api.clients.updateBilling, {
      clientId: ours.clientId,
      email: "",
      whatsapp: "",
      creditDays: null,
      notifyBy: null,
    }),
  ).rejects.toThrow(gone);
  await expect(rival.mutation(api.clients.clearLocation, { clientId: ours.clientId })).rejects.toThrow(gone);
  await expect(
    rival.mutation(api.clients.setLocation, { clientId: ours.clientId, location: FAR }),
  ).rejects.toThrow(gone);
  await expect(
    rival.mutation(api.clients.merge, { fromId: ours.clientId, intoId: theirs.clientId }),
  ).rejects.toThrow(gone);
  await expect(
    rival.mutation(api.clients.merge, { fromId: theirs.clientId, intoId: ours.clientId }),
  ).rejects.toThrow(gone);
  await expect(rival.mutation(api.reminders.sendTest, { clientId: ours.clientId })).rejects.toThrow(gone);

  // Deliveries, vehicles and routes.
  await expect(
    rival.mutation(api.deliveries.setPayment, { id: ours.deliveryId, payment: "pagado" }),
  ).rejects.toThrow("La entrega ya no existe");
  await expect(
    rival.mutation(api.vehicles.rename, { vehicleId: ours.vehicleId, name: "Suya" }),
  ).rejects.toThrow("El vehículo ya no existe");
  await expect(
    rival.mutation(api.vehicles.setActive, { vehicleId: ours.vehicleId, active: false }),
  ).rejects.toThrow("El vehículo ya no existe");
  const route = { stops: [{ clientId: theirs.clientId }], returnToBase: false };
  await expect(
    rival.mutation(api.routes.create, { ...route, driverId, stops: [{ clientId: theirs.clientId }] }),
  ).rejects.toThrow("ya no tiene acceso");
  await expect(
    rival.mutation(api.routes.create, {
      ...route,
      driverId: (await rival.query(api.users.listDrivers, {})).drivers[0]._id,
      stops: [{ clientId: ours.clientId }],
    }),
  ).rejects.toThrow("Uno de los clientes ya no existe");
  await expect(
    rival.mutation(api.routes.update, { ...route, routeId: ours.routeId, driverId }),
  ).rejects.toThrow("Esa ruta ya no existe");
  await rival.mutation(api.routes.remove, { routeId: ours.routeId });

  // Users.
  await expect(
    rival.mutation(api.members.setRole, { memberId: ourMember._id, role: "admin" }),
  ).rejects.toThrow("Ese usuario ya no existe");
  await expect(rival.mutation(api.members.remove, { memberId: ourMember._id })).rejects.toThrow(
    "Ese usuario ya no existe",
  );

  // Their own settings are theirs: ours stay.
  await rival.mutation(api.settings.setBase, { base: FAR });
  await rival.mutation(api.companies.update, {
    name: "Limpieza Rival",
    timeZone: "America/Tijuana",
    phoneCountryCode: "1",
    tagline: "",
    serviceArea: null,
  });

  expect(await everythingOf(companyId)).toEqual(before);
  expect((await t.run(async (ctx) => await ctx.db.get(companyId)))!.base).toEqual(HERE);

  // A driver's phone can send ids it has stored. One from another company
  // never stops the upload: the delivery is saved in the driver's own company.
  const stored = await asRivalDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({
      invoice: "F-2",
      clientId: ours.clientId,
      clientName: "Hotel Cozumel",
      vehicleId: ours.vehicleId,
      // The same request id as one of our deliveries.
      clientRequestId: "phone-1",
    }),
  );
  expect(stored).toBe(theirs.deliveryId);
  const saved = await asRivalDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({
      invoice: "F-2",
      clientId: ours.clientId,
      clientName: "Hotel Cozumel",
      vehicleId: ours.vehicleId,
      clientRequestId: "phone-2",
    }),
  );
  expect(await t.run(async (ctx) => await ctx.db.get(saved))).toMatchObject({
    companyId: theirs.companyId,
    clientId: theirs.clientId,
    driverName: "Chofer Rival",
  });
  expect((await t.run(async (ctx) => await ctx.db.get(saved)))!.vehicleId).toBeUndefined();
  expect(await everythingOf(companyId)).toEqual(before);
});

test("a retried upload is only matched to the same driver's delivery", async () => {
  const { t, asOtherDriver, ours, deliveryArgs } = await setupTwoCompanies();

  // Another driver of the same company sends a request id that's already used:
  // they don't get the first driver's delivery back, theirs is saved.
  const id = await asOtherDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ invoice: "F-3", clientRequestId: "phone-1" }),
  );
  expect(id).not.toBe(ours.deliveryId);
  expect((await t.run(async (ctx) => await ctx.db.get(id)))!.driverName).toBe("Chofer Dos");
  // And their own retry still finds it.
  expect(
    await asOtherDriver.mutation(
      api.deliveries.create,
      await deliveryArgs({ invoice: "F-3", clientRequestId: "phone-1" }),
    ),
  ).toBe(id);
});

test("each company's reminders only look at its own clients and deliveries", async () => {
  const { t, companyId, otherCompanyId, ours, theirs } = await setupTwoCompanies();
  // Both deliveries were made today, with 30 days of credit: each is due 30
  // days from today in its own company's zone.
  const dueOn = (id: Id<"companies">, timeZone: string) =>
    t.query(internal.reminders.pending, {
      companyId: id,
      today: shiftDays(isoDate(Date.now(), timeZone), 30),
      start: "2026-01-01",
    });

  // The log row made in the setup marked both as reminded by email already.
  await t.run(async (ctx) => {
    await ctx.db.patch(ours.deliveryId, { reminded: undefined });
    await ctx.db.patch(theirs.deliveryId, { reminded: undefined });
  });

  const mine = await dueOn(companyId, "America/Cancun");
  expect(mine.map((b) => b.deliveryIds)).toEqual([[ours.deliveryId]]);
  const others = await dueOn(otherCompanyId, "America/Tijuana");
  expect(others.map((b) => b.deliveryIds)).toEqual([[theirs.deliveryId]]);
});
