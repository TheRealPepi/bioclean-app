// @vitest-environment edge-runtime
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { MAX_ROUTE_STOPS, ROUTE_KEEP_MS, ROUTE_TTL_MS } from "./lib/routes";
import { FAR, HERE, setup } from "./test.setup";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

afterEach(() => {
  vi.useRealTimers();
});

/** The usual setup plus a way to add clients, with or without a saved location. */
async function setupRoutes() {
  const base = await setup();
  const client = (name: string, location?: typeof HERE) =>
    base.t.run(
      async (ctx) =>
        await ctx.db.insert("clients", {
          companyId: base.companyId,
          name,
          normalizedName: name,
          deliveryCount: 0,
          location,
        }),
    );
  return { ...base, client };
}

test("a route needs a driver with access and stops that can be reached", async () => {
  const { t, asAdmin, asDriver, driverId, rivalDriverId, client } = await setupRoutes();
  const hotel = await client("HOTEL", HERE);
  const noLocation = await client("TIENDA NUEVA");
  const create = (stops: { clientId: typeof hotel; location?: typeof HERE }[], driver = driverId) =>
    asAdmin.mutation(api.routes.create, { driverId: driver, stops, returnToBase: false });

  await expect(create([])).rejects.toThrow("Elige al menos un cliente");
  await expect(create([{ clientId: hotel }, { clientId: hotel }])).rejects.toThrow(
    "cliente repetido",
  );
  await expect(create([{ clientId: noLocation }])).rejects.toThrow("no tiene ubicación");
  await expect(
    create([{ clientId: noLocation, location: { lat: 200, lng: 0 } }]),
  ).rejects.toThrow("no es válida");

  const many = await Promise.all(
    Array.from({ length: MAX_ROUTE_STOPS + 1 }, (_, i) => client(`CLIENTE ${i}`, HERE)),
  );
  await expect(create(many.map((clientId) => ({ clientId })))).rejects.toThrow("hasta 25 paradas");

  const outsider = await t.run(
    async (ctx) => await ctx.db.insert("users", { email: "ya-no-trabaja@example.com" }),
  );
  await expect(create([{ clientId: hotel }], outsider)).rejects.toThrow("ya no tiene acceso");
  // Having access to another company doesn't count.
  await expect(create([{ clientId: hotel }], rivalDriverId)).rejects.toThrow("ya no tiene acceso");

  await expect(
    asDriver.mutation(api.routes.create, {
      driverId,
      stops: [{ clientId: hotel }],
      returnToBase: false,
    }),
  ).rejects.toThrow("Solo el administrador");

  expect(await asAdmin.query(api.routes.listAdmin, {})).toEqual([]);
});

test("a route copies each client's location, or the one the office chose for it", async () => {
  const { asAdmin, driverId, client } = await setupRoutes();
  const hotel = await client("HOTEL", HERE);
  const noLocation = await client("TIENDA NUEVA");
  await asAdmin.mutation(api.settings.setBase, { base: FAR });

  await asAdmin.mutation(api.routes.create, {
    driverId,
    stops: [{ clientId: noLocation, location: FAR }, { clientId: hotel }],
    returnToBase: true,
  });

  const [route] = await asAdmin.query(api.routes.listAdmin, {});
  expect(route).toMatchObject({ driverName: "Chofer Uno", base: FAR, returnToBase: true });
  expect(route.expiresAt - route.createdAt).toBeCloseTo(ROUTE_TTL_MS, -3);
  expect(route.stops).toEqual([
    { clientId: noLocation, clientName: "TIENDA NUEVA", location: FAR, customLocation: true, deliveryId: null },
    { clientId: hotel, clientName: "HOTEL", location: HERE, customLocation: false, deliveryId: null },
  ]);
});

test("a stop counts as delivered once the client gets a delivery after the route was made", async () => {
  // The test moves the clock itself: this is about what happened before and after.
  vi.useFakeTimers({ toFake: ["Date"] });
  const { asAdmin, asDriver, asOtherDriver, driverId, client, deliveryArgs } = await setupRoutes();
  const hotel = await client("HOTEL", HERE);
  const restaurant = await client("RESTAURANTE", FAR);
  const deliver = async (clientId: typeof hotel, invoice: string) =>
    asDriver.mutation(
      api.deliveries.create,
      await deliveryArgs({ clientId, clientName: "", invoice }),
    );

  // A delivery to the restaurant earlier today has nothing to do with the route.
  await deliver(restaurant, "F-1");
  vi.setSystemTime(Date.now() + HOUR_MS);
  await asAdmin.mutation(api.routes.create, {
    driverId,
    stops: [{ clientId: hotel }, { clientId: restaurant }],
    returnToBase: false,
  });
  const delivered = async () =>
    (await asDriver.query(api.routes.listMine, {}))[0].stops.map((s) => s.delivered);

  expect(await delivered()).toEqual([false, false]);
  vi.setSystemTime(Date.now() + HOUR_MS);
  await deliver(hotel, "F-2");
  expect(await delivered()).toEqual([true, false]);

  // Each driver sees only their own routes.
  expect(await asOtherDriver.query(api.routes.listMine, {})).toEqual([]);
});

test("editing a route keeps when it expires, and an expired route can't be edited", async () => {
  const { t, asAdmin, driverId, otherDriverId, client } = await setupRoutes();
  const hotel = await client("HOTEL", HERE);
  const restaurant = await client("RESTAURANTE", FAR);
  const routeId = await asAdmin.mutation(api.routes.create, {
    driverId,
    stops: [{ clientId: hotel }],
    returnToBase: false,
  });
  const saved = async () => (await t.run(async (ctx) => await ctx.db.get(routeId)))!;
  const { expiresAt } = await saved();
  const changes = {
    routeId,
    driverId: otherDriverId,
    stops: [{ clientId: restaurant }, { clientId: hotel }],
    returnToBase: false,
  };

  await asAdmin.mutation(api.routes.update, changes);
  expect(await saved()).toMatchObject({ driverId: otherDriverId, driverName: "Chofer Dos", expiresAt });
  expect((await saved()).stops.map((s) => s.clientId)).toEqual([restaurant, hotel]);

  await t.run(async (ctx) => await ctx.db.patch(routeId, { expiresAt: Date.now() - HOUR_MS }));
  await expect(asAdmin.mutation(api.routes.update, changes)).rejects.toThrow("ya venció");
});

test("the daily cleanup deletes only routes that expired more than 30 days ago", async () => {
  const { t, companyId, driverId } = await setupRoutes();
  const route = (expiresAt: number) =>
    t.run(
      async (ctx) =>
        await ctx.db.insert("routes", {
          companyId,
          driverId,
          driverName: "Chofer Uno",
          stops: [],
          returnToBase: false,
          expiresAt,
        }),
    );
  const old = await route(Date.now() - ROUTE_KEEP_MS - DAY_MS);
  const recent = await route(Date.now() - DAY_MS);
  const active = await route(Date.now() + DAY_MS);

  expect(await t.mutation(internal.routes.purgeExpired, {})).toEqual({ deleted: 1 });

  const left = await t.run(async (ctx) => await ctx.db.query("routes").collect());
  expect(left.map((r) => r._id)).toEqual([recent, active]);
  expect(left.map((r) => r._id)).not.toContain(old);
});
