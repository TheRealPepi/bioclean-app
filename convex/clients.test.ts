// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { FAR, HERE, setup } from "./test.setup";

test("the same client typed with different accents, case or spacing is one client", async () => {
  const { t, asDriver, deliveryArgs } = await setup();

  for (const [invoice, clientName] of [
    ["F-1", "Hotel Cozumél"],
    ["F-2", "  hotel   cozumel "],
  ]) {
    await asDriver.mutation(api.deliveries.create, await deliveryArgs({ invoice, clientName }));
  }

  const clients = await t.run(async (ctx) => await ctx.db.query("clients").collect());
  expect(clients).toHaveLength(1);
  expect(clients[0]).toMatchObject({ name: "HOTEL COZUMÉL", deliveryCount: 2 });
});

test("renaming a client renames its deliveries, and can't create a duplicate", async () => {
  const { t, asAdmin, asDriver, deliveryArgs } = await setup();
  await asDriver.mutation(api.deliveries.create, await deliveryArgs({ invoice: "F-1" }));
  const deliveryId = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ invoice: "F-2", clientName: "Restaurante" }),
  );
  const { clientId } = (await t.run(async (ctx) => await ctx.db.get(deliveryId)))!;

  await expect(
    asAdmin.mutation(api.clients.rename, { clientId, name: "hotel cozumél" }),
  ).rejects.toThrow("Ya existe el cliente");
  await expect(asAdmin.mutation(api.clients.rename, { clientId, name: " . " })).rejects.toThrow(
    "no puede estar vacío",
  );

  await asAdmin.mutation(api.clients.rename, { clientId, name: "Restaurante la Choza" });
  const { client, delivery } = await t.run(async (ctx) => ({
    client: (await ctx.db.get(clientId))!,
    delivery: (await ctx.db.get(deliveryId))!,
  }));
  expect(client).toMatchObject({ name: "RESTAURANTE LA CHOZA", normalizedName: "RESTAURANTE LA CHOZA" });
  expect(delivery.clientName).toBe("RESTAURANTE LA CHOZA");
});

test("merging two clients keeps everything from both under the one that stays", async () => {
  const { t, asAdmin, asDriver, driverId, deliveryArgs } = await setup();

  // The duplicate has a delivery, a saved location and reminder settings.
  const deliveryId = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ clientName: "Hotel Cozumel SA" }),
  );
  const fromId = (await t.run(async (ctx) => await ctx.db.get(deliveryId)))!.clientId;
  await asAdmin.mutation(api.clients.updateBilling, {
    clientId: fromId,
    email: "pagos@hotel.mx",
    whatsapp: "",
    creditDays: 30,
    notifyBy: "email",
  });

  // The one that stays has nothing yet, and there's an unrelated third client.
  const { intoId, otherId, routeWithFrom, routeWithBoth } = await t.run(async (ctx) => {
    const client = (name: string, location?: typeof HERE) =>
      ctx.db.insert("clients", { name, normalizedName: name, deliveryCount: 0, location });
    const intoId = await client("HOTEL COZUMEL");
    const otherId = await client("RESTAURANTE", FAR);
    const stop = (clientId: typeof intoId, clientName: string) => ({
      clientId,
      clientName,
      location: HERE,
    });
    const route = (stops: ReturnType<typeof stop>[]) =>
      ctx.db.insert("routes", {
        driverId,
        driverName: "Chofer Uno",
        stops,
        returnToBase: false,
        expiresAt: Date.now() + 1000,
      });
    return {
      intoId,
      otherId,
      routeWithFrom: await route([
        stop(fromId, "HOTEL COZUMEL SA"),
        stop(otherId, "RESTAURANTE"),
      ]),
      routeWithBoth: await route([
        stop(fromId, "HOTEL COZUMEL SA"),
        stop(intoId, "HOTEL COZUMEL"),
        stop(otherId, "RESTAURANTE"),
      ]),
    };
  });

  await expect(asAdmin.mutation(api.clients.merge, { fromId, intoId: fromId })).rejects.toThrow(
    "Elige un cliente distinto",
  );
  await asAdmin.mutation(api.clients.merge, { fromId, intoId });

  const after = await t.run(async (ctx) => ({
    from: await ctx.db.get(fromId),
    into: (await ctx.db.get(intoId))!,
    delivery: (await ctx.db.get(deliveryId))!,
    routeWithFrom: (await ctx.db.get(routeWithFrom))!,
    routeWithBoth: (await ctx.db.get(routeWithBoth))!,
  }));
  expect(after.from).toBeNull();
  expect(after.into).toMatchObject({
    deliveryCount: 1,
    lastDeliveryAt: after.delivery.deliveredAt,
    location: HERE,
    email: "pagos@hotel.mx",
    creditDays: 30,
    notifyBy: "email",
  });
  expect(after.delivery).toMatchObject({ clientId: intoId, clientName: "HOTEL COZUMEL" });
  // Routes keep the stop, now for the client that stays...
  expect(after.routeWithFrom.stops.map((s) => [s.clientId, s.clientName])).toEqual([
    [intoId, "HOTEL COZUMEL"],
    [otherId, "RESTAURANTE"],
  ]);
  // ...unless that client was already a stop: a route never has a client twice.
  expect(after.routeWithBoth.stops.map((s) => s.clientId)).toEqual([intoId, otherId]);
});

test("reminder settings are checked before they're saved", async () => {
  const { t, asAdmin, asDriver, deliveryArgs } = await setup();
  const deliveryId = await asDriver.mutation(api.deliveries.create, await deliveryArgs());
  const { clientId } = (await t.run(async (ctx) => await ctx.db.get(deliveryId)))!;
  const valid = {
    clientId,
    email: " Pagos@Hotel.mx ",
    whatsapp: "987 123 4567",
    creditDays: 30,
    notifyBy: "ambos" as const,
  };
  const save = (changes: Partial<Omit<typeof valid, "creditDays">> & { creditDays?: number | null }) =>
    asAdmin.mutation(api.clients.updateBilling, { ...valid, ...changes });

  await expect(save({ email: "pagos@hotel" })).rejects.toThrow("El correo no es válido");
  await expect(save({ whatsapp: "12345" })).rejects.toThrow("WhatsApp no es válido");
  await expect(save({ creditDays: 0 })).rejects.toThrow("entre 1 y 365");
  await expect(save({ creditDays: 1.5 })).rejects.toThrow("entre 1 y 365");
  // A channel can't be chosen without the data to use it.
  await expect(save({ email: "" })).rejects.toThrow("Escribe el correo");
  await expect(save({ whatsapp: "" })).rejects.toThrow("Escribe el WhatsApp");
  await expect(save({ creditDays: null })).rejects.toThrow("Escribe los días de crédito");

  await save({});
  expect(await t.run(async (ctx) => await ctx.db.get(clientId))).toMatchObject({
    email: "pagos@hotel.mx",
    whatsapp: "529871234567",
    creditDays: 30,
    notifyBy: "ambos",
  });

  // Drivers keep the client list on their phones: it never has billing data.
  const [forDriver] = await asDriver.query(api.clients.list, {});
  expect(Object.keys(forDriver).sort()).toEqual([
    "_id",
    "deliveryCount",
    "lastDeliveryAt",
    "location",
    "name",
  ]);
  await expect(asDriver.query(api.clients.listAdmin, {})).rejects.toThrow("Solo el administrador");
});
