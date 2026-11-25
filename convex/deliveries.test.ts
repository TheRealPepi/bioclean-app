// @vitest-environment edge-runtime
import { expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { ADMIN_EMAIL, FAR, HERE, setup } from "./test.setup";

const ANY_TIME = { from: 0, to: Number.MAX_SAFE_INTEGER };

test("only people on the access lists can use the app, and only the office sees everything", async () => {
  const { t, asAdmin, asDriver, asOutsider, deliveryArgs } = await setup();

  await expect(t.mutation(api.deliveries.create, await deliveryArgs())).rejects.toThrow(
    "No tienes acceso",
  );
  await expect(asOutsider.mutation(api.deliveries.create, await deliveryArgs())).rejects.toThrow(
    "No tienes acceso",
  );

  const id = await asDriver.mutation(api.deliveries.create, await deliveryArgs());
  await expect(asDriver.query(api.deliveries.list, ANY_TIME)).rejects.toThrow("Solo el administrador");
  await expect(
    asDriver.mutation(api.deliveries.setPayment, { id, payment: "pagado" }),
  ).rejects.toThrow("Solo el administrador");
  expect(await asAdmin.query(api.deliveries.list, ANY_TIME)).toHaveLength(1);

  // Access lists are typed by hand: letter case and separators don't matter.
  vi.stubEnv("ADMIN_EMAILS", `otra@example.com; ${ADMIN_EMAIL.toUpperCase()}`);
  expect(await asAdmin.query(api.deliveries.list, ANY_TIME)).toHaveLength(1);
  // Taking someone off the list takes effect right away.
  vi.stubEnv("ADMIN_EMAILS", "otra@example.com");
  await expect(asAdmin.query(api.deliveries.list, ANY_TIME)).rejects.toThrow("No tienes acceso");
});

test("a delivery creates the client, counts it and saves its first location", async () => {
  const { t, asDriver, driverId, deliveryArgs } = await setup();

  const id = await asDriver.mutation(api.deliveries.create, await deliveryArgs({ invoice: " f 100 " }));

  const { delivery, clients, numbers } = await t.run(async (ctx) => ({
    delivery: (await ctx.db.get(id))!,
    clients: await ctx.db.query("clients").collect(),
    numbers: await ctx.db.query("invoiceNumbers").collect(),
  }));
  expect(clients).toHaveLength(1);
  expect(clients[0]).toMatchObject({ name: "HOTEL COZUMEL", deliveryCount: 1, location: HERE });
  expect(delivery).toMatchObject({
    clientId: clients[0]._id,
    clientName: "HOTEL COZUMEL",
    invoiceNumber: "F100",
    locationSource: "nueva",
    driverId,
    driverName: "Chofer Uno",
  });
  expect(delivery.invoices![0].repeat).toBeUndefined();
  expect(numbers.map((n) => n.number)).toEqual(["F100"]);
});

test("an upload that is retried is saved only once", async () => {
  const { t, asDriver, deliveryArgs } = await setup();

  const first = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ clientRequestId: "phone-1" }),
  );
  const retry = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ clientRequestId: "phone-1" }),
  );

  expect(retry).toBe(first);
  const { deliveries, clients } = await t.run(async (ctx) => ({
    deliveries: await ctx.db.query("deliveries").collect(),
    clients: await ctx.db.query("clients").collect(),
  }));
  expect(deliveries).toHaveLength(1);
  expect(clients[0].deliveryCount).toBe(1);
});

test("a delivery needs a factura number, no repeated numbers, and photos that were uploaded", async () => {
  const { t, asDriver, photo, deliveryArgs } = await setup();
  const create = async (overrides: Parameters<typeof deliveryArgs>[0]) =>
    asDriver.mutation(api.deliveries.create, await deliveryArgs(overrides));

  await expect(create({ invoices: [] })).rejects.toThrow("Falta el número de factura");
  await expect(create({ invoice: "   " })).rejects.toThrow("Falta el número de factura");
  await expect(
    create({
      invoices: [
        { number: "f-1", photoId: await photo() },
        { number: " F -1", photoId: await photo() },
      ],
    }),
  ).rejects.toThrow("número de factura repetido");

  const lost = await photo();
  await t.run(async (ctx) => await ctx.storage.delete(lost));
  await expect(create({ receiverPhotoId: lost })).rejects.toThrow("no se subió correctamente");

  expect(await t.run(async (ctx) => await ctx.db.query("deliveries").collect())).toEqual([]);
});

test("a delivery with a problem needs an explanation", async () => {
  const { t, asDriver, deliveryArgs } = await setup();

  await expect(
    asDriver.mutation(api.deliveries.create, await deliveryArgs({ status: "faltante" })),
  ).rejects.toThrow("Describe qué pasó");

  const id = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ status: "faltante", clientNotes: " Faltó una caja " }),
  );
  expect(await t.run(async (ctx) => await ctx.db.get(id))).toMatchObject({
    status: "faltante",
    clientNotes: "Faltó una caja",
  });
});

test("a repeated factura is saved and marked for the office, never rejected", async () => {
  const { asAdmin, asDriver, asOtherDriver, photo, deliveryArgs } = await setup();
  const deliver = async (clientName: string, followUp?: boolean) =>
    asDriver.mutation(
      api.deliveries.create,
      await deliveryArgs({
        clientName,
        invoices: [{ number: "F-1", photoId: await photo(), followUp }],
      }),
    );

  const original = await deliver("Hotel Cozumel");
  const followUp = await deliver("Hotel Cozumel", true);
  const unconfirmed = await deliver("Hotel Cozumel");
  // The same number for another client can't be a follow-up, whatever the phone says.
  const otherClient = await deliver("Restaurante La Choza", true);

  const listed = await asAdmin.query(api.deliveries.list, ANY_TIME);
  const repeat = (id: string) => listed.find((d) => d._id === id)!.repeat;
  expect(repeat(original)).toBeNull();
  expect(repeat(followUp)).toBe("seguimiento");
  expect(repeat(unconfirmed)).toBe("posible_duplicado");
  expect(repeat(otherClient)).toBe("posible_duplicado");

  // The office sees which earlier delivery had the number.
  const detail = await asAdmin.query(api.deliveries.get, { id: followUp });
  expect(detail!.invoices[0].previous).toMatchObject({ id: original, otherClientName: null });
  const other = await asAdmin.query(api.deliveries.get, { id: otherClient });
  expect(other!.invoices[0].previous!.otherClientName).toBe("HOTEL COZUMEL");

  // The wizard asks about it for any driver, not only the one who delivered it.
  const [found] = await asOtherDriver.query(api.deliveries.findByInvoices, { numbers: [" f-1 "] });
  expect(found.number).toBe("F-1");
  expect(found.earlier).toHaveLength(4);
});

test("the server decides whether a delivery was at the client's saved location", async () => {
  const { t, asDriver, deliveryArgs } = await setup();
  const deliver = async (overrides: Parameters<typeof deliveryArgs>[0]) => {
    const id = await asDriver.mutation(api.deliveries.create, await deliveryArgs(overrides));
    return (await t.run(async (ctx) => await ctx.db.get(id)))!;
  };
  const NEARBY = { lat: HERE.lat + 0.0001, lng: HERE.lng }; // about 11 m away

  expect((await deliver({ invoice: "F-1" })).locationSource).toBe("nueva");

  const elsewhere = await deliver({ invoice: "F-2", location: FAR, driverPosition: FAR });
  expect(elsewhere.locationSource).toBe("modificada");
  expect(elsewhere.driverPosition).toBeUndefined();

  const nearby = await deliver({ invoice: "F-3", location: NEARBY, locationSource: "modificada" });
  expect(nearby.locationSource).toBe("guardada");

  const confirmed = await deliver({
    invoice: "F-4",
    locationSource: "guardada",
    driverPosition: FAR,
  });
  expect(confirmed).toMatchObject({ locationSource: "guardada", driverPosition: FAR });

  // A delivery somewhere else never moves the client's saved location.
  const [client] = await t.run(async (ctx) => await ctx.db.query("clients").collect());
  expect(client).toMatchObject({ location: HERE, deliveryCount: 4 });
});

test("a delivery keeps the time it was made on the phone, but is never dated in the future", async () => {
  const { t, asDriver, deliveryArgs } = await setup();
  const HOUR_MS = 60 * 60 * 1000;
  const deliveredAt = async (sentByPhone: number, invoice: string) => {
    const id = await asDriver.mutation(
      api.deliveries.create,
      await deliveryArgs({ invoice, deliveredAt: sentByPhone }),
    );
    return (await t.run(async (ctx) => await ctx.db.get(id)))!.deliveredAt!;
  };

  // Saved without signal three hours ago and uploaded now.
  const earlier = Date.now() - 3 * HOUR_MS;
  expect(await deliveredAt(earlier, "F-1")).toBe(earlier);

  // The phone's clock is a day ahead: the server's time is used instead.
  const now = Date.now();
  const saved = await deliveredAt(now + 24 * HOUR_MS, "F-2");
  expect(Math.abs(saved - now)).toBeLessThan(HOUR_MS);
});

test("a driver can open only their own deliveries", async () => {
  const { asAdmin, asDriver, asOtherDriver, deliveryArgs } = await setup();
  const id = await asDriver.mutation(api.deliveries.create, await deliveryArgs());

  expect(await asDriver.query(api.deliveries.get, { id })).toMatchObject({ isAdmin: false });
  expect(await asAdmin.query(api.deliveries.get, { id })).toMatchObject({ isAdmin: true });
  expect(await asOtherDriver.query(api.deliveries.get, { id })).toBeNull();
  expect(await asDriver.query(api.deliveries.get, { id: "no-es-un-id" })).toBeNull();
  expect(await asOtherDriver.query(api.deliveries.listMine, { since: 0 })).toEqual([]);
});

test("the office marks a credit delivery as paid, and can undo it", async () => {
  const { t, asAdmin, asDriver, deliveryArgs } = await setup();
  const id = await asDriver.mutation(
    api.deliveries.create,
    await deliveryArgs({ payment: "credito" }),
  );
  const saved = async () => (await t.run(async (ctx) => await ctx.db.get(id)))!;

  await asAdmin.mutation(api.deliveries.setPayment, { id, payment: "pagado" });
  expect(await saved()).toMatchObject({ payment: "pagado", paidAt: expect.any(Number) });

  await asAdmin.mutation(api.deliveries.setPayment, { id, payment: "credito" });
  expect(await saved()).toMatchObject({ payment: "credito" });
  expect((await saved()).paidAt).toBeUndefined();
});
