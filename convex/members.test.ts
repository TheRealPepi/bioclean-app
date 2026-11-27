// @vitest-environment edge-runtime
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  ADMIN_EMAIL,
  DRIVER_EMAIL,
  OFFICE_EMAIL,
  OTHER_DRIVER_EMAIL,
  OWNER_EMAIL,
  RIVAL_DRIVER_EMAIL,
  setup,
} from "./test.setup";

/** The usual setup plus a way to find a user of the first company by email. */
async function setupMembers() {
  const base = await setup();
  const { t, asAdmin } = base;
  const memberId = async (email: string) =>
    (await asAdmin.query(api.members.list, {})).find((m) => m.email === email)!._id;
  /** Someone signs in with Google for the first time. */
  const signIn = async (name: string, email: string) => {
    const id = await t.run(async (ctx) => await ctx.db.insert("users", { name, email }));
    return t.withIdentity({ subject: `${id}|test` });
  };
  return { ...base, memberId, signIn };
}

test("an admin gives an email a role, and the person gets in when they sign in with it", async () => {
  const { asAdmin, signIn } = await setupMembers();

  await expect(
    asAdmin.mutation(api.members.add, { email: "nuevo@example", role: "driver" }),
  ).rejects.toThrow("El correo no es válido");
  await asAdmin.mutation(api.members.add, { email: "  Nuevo@Example.com ", role: "driver" });

  // Until then they show as pending, here and in the office's driver list.
  const pending = (await asAdmin.query(api.members.list, {})).find(
    (m) => m.email === "nuevo@example.com",
  );
  expect(pending).toMatchObject({ role: "driver", name: null, image: null, isMe: false });
  expect((await asAdmin.query(api.users.listDrivers, {})).pendingEmails).toEqual([
    "nuevo@example.com",
  ]);

  const asNew = await signIn("Nuevo Chofer", "nuevo@example.com");
  expect(await asNew.query(api.users.me)).toMatchObject({
    memberRole: "driver",
    company: { name: "Bioclean Green Cozumel" },
  });
  expect(await asNew.query(api.clients.list, {})).toEqual([]);
  expect((await asAdmin.query(api.members.list, {})).map((m) => [m.email, m.role, m.name])).toEqual([
    [OWNER_EMAIL, "owner", "Dueña"],
    [ADMIN_EMAIL, "admin", "Oficina"],
    [OFFICE_EMAIL, "office", "Auxiliar"],
    [DRIVER_EMAIL, "driver", "Chofer Uno"],
    [OTHER_DRIVER_EMAIL, "driver", "Chofer Dos"],
    ["nuevo@example.com", "driver", "Nuevo Chofer"],
  ]);
  expect((await asAdmin.query(api.users.listDrivers, {})).pendingEmails).toEqual([]);
});

test("an email is in one company only", async () => {
  const { asAdmin, asRivalAdmin } = await setupMembers();
  const add = (email: string) => asAdmin.mutation(api.members.add, { email, role: "office" });

  await expect(add(DRIVER_EMAIL.toUpperCase())).rejects.toThrow("ya es usuario de tu empresa");
  await expect(add(RIVAL_DRIVER_EMAIL)).rejects.toThrow("ya pertenece a otra empresa");

  // Once the other company lets them go, they can be added.
  const rival = (await asRivalAdmin.query(api.members.list, {})).find(
    (m) => m.email === RIVAL_DRIVER_EMAIL,
  )!;
  await asRivalAdmin.mutation(api.members.remove, { memberId: rival._id });
  await add(RIVAL_DRIVER_EMAIL);
});

test("the owner can't be changed or removed, and nobody changes their own access", async () => {
  const { t, companyId, asOwner, asAdmin, memberId } = await setupMembers();
  const owner = await memberId(OWNER_EMAIL);
  const admin = await memberId(ADMIN_EMAIL);
  const office = await memberId(OFFICE_EMAIL);

  await expect(
    asAdmin.mutation(api.members.add, { email: "otra@example.com", role: "owner" }),
  ).rejects.toThrow("solo tiene un dueño");
  await expect(
    asAdmin.mutation(api.members.setRole, { memberId: office, role: "owner" }),
  ).rejects.toThrow("solo tiene un dueño");
  await expect(
    asAdmin.mutation(api.members.setRole, { memberId: owner, role: "driver" }),
  ).rejects.toThrow("dueño de la empresa no se puede");
  await expect(asAdmin.mutation(api.members.remove, { memberId: owner })).rejects.toThrow(
    "dueño de la empresa no se puede",
  );
  // Not even the owner: a company always has one.
  await expect(asOwner.mutation(api.members.remove, { memberId: owner })).rejects.toThrow(
    "dueño de la empresa no se puede",
  );

  await expect(
    asAdmin.mutation(api.members.setRole, { memberId: admin, role: "office" }),
  ).rejects.toThrow("tu propio acceso");
  await expect(asAdmin.mutation(api.members.remove, { memberId: admin })).rejects.toThrow(
    "tu propio acceso",
  );

  // Whoever runs the deployment can hand the company to another of its users.
  await expect(
    t.mutation(internal.members.transferOwnership, { companyId, email: RIVAL_DRIVER_EMAIL }),
  ).rejects.toThrow("no es usuario de esa empresa");
  await t.mutation(internal.members.transferOwnership, { companyId, email: ADMIN_EMAIL });
  expect(
    (await asAdmin.query(api.members.list, {})).slice(0, 2).map((m) => [m.email, m.role]),
  ).toEqual([
    [ADMIN_EMAIL, "owner"],
    [OWNER_EMAIL, "admin"],
  ]);
});

test("only owners and admins manage users, and a new role applies on the next call", async () => {
  const { asAdmin, asOffice, asDriver, memberId } = await setupMembers();
  const office = await memberId(OFFICE_EMAIL);
  const driver = await memberId(DRIVER_EMAIL);

  for (const who of [asOffice, asDriver]) {
    await expect(who.query(api.members.list, {})).rejects.toThrow("Solo el administrador");
    await expect(
      who.mutation(api.members.add, { email: "amigo@example.com", role: "admin" }),
    ).rejects.toThrow("Solo el administrador");
    await expect(
      who.mutation(api.members.setRole, { memberId: office, role: "admin" }),
    ).rejects.toThrow("Solo el administrador");
    await expect(who.mutation(api.members.remove, { memberId: driver })).rejects.toThrow(
      "Solo el administrador",
    );
  }

  await asAdmin.mutation(api.members.setRole, { memberId: office, role: "admin" });
  expect(await asOffice.query(api.members.list, {})).toHaveLength(5);
  // The driver becomes office: the whole company's deliveries, but still no users.
  await asAdmin.mutation(api.members.setRole, { memberId: driver, role: "office" });
  expect(await asDriver.query(api.deliveries.list, { from: 0, to: 1 })).toEqual([]);
  await expect(asDriver.query(api.members.list, {})).rejects.toThrow("Solo el administrador");
});

test("a company's admin can't touch the users of another one", async () => {
  const { asAdmin, asRivalAdmin, memberId } = await setupMembers();
  const driver = await memberId(DRIVER_EMAIL);

  await expect(
    asRivalAdmin.mutation(api.members.setRole, { memberId: driver, role: "admin" }),
  ).rejects.toThrow("Ese usuario ya no existe");
  await expect(asRivalAdmin.mutation(api.members.remove, { memberId: driver })).rejects.toThrow(
    "Ese usuario ya no existe",
  );
  expect((await asRivalAdmin.query(api.members.list, {})).map((m) => m.email)).toEqual([
    "oficina@rival.example",
    RIVAL_DRIVER_EMAIL,
  ]);
  expect(await asAdmin.query(api.members.list, {})).toHaveLength(5);
});

test("the office's driver list is the company's drivers, plus anyone else who delivered", async () => {
  const { asAdmin, asOffice, asDriver, asRivalDriver, deliveryArgs } = await setupMembers();
  const names = async (who: typeof asAdmin) =>
    (await who.query(api.users.listDrivers, {})).drivers.map((d) => [d.name, d.deliveryCount]);

  await asDriver.mutation(api.deliveries.create, await deliveryArgs({ invoice: "F-1" }));
  await asRivalDriver.mutation(api.deliveries.create, await deliveryArgs({ invoice: "F-1" }));
  expect(await names(asAdmin)).toEqual([
    ["Chofer Dos", 0],
    ["Chofer Uno", 1],
  ]);

  // Someone from the office covers a delivery: they can be given routes too.
  await asOffice.mutation(api.deliveries.create, await deliveryArgs({ invoice: "F-2" }));
  expect(await names(asOffice)).toEqual([
    ["Auxiliar", 1],
    ["Chofer Dos", 0],
    ["Chofer Uno", 1],
  ]);
  await expect(asDriver.query(api.users.listDrivers, {})).rejects.toThrow("Solo el administrador");

  // A removed driver is no longer offered for routes; their deliveries stay.
  const driver = (await asAdmin.query(api.members.list, {})).find((m) => m.email === DRIVER_EMAIL)!;
  await asAdmin.mutation(api.members.remove, { memberId: driver._id as Id<"members"> });
  expect(await names(asAdmin)).toEqual([
    ["Auxiliar", 1],
    ["Chofer Dos", 0],
  ]);
  expect(await asAdmin.query(api.deliveries.list, { from: 0, to: Number.MAX_SAFE_INTEGER })).toHaveLength(2);
});
