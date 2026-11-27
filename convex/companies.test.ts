// @vitest-environment edge-runtime
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { ADMIN_EMAIL, HERE, setup } from "./test.setup";

const NEW_COMPANY = {
  name: "  Lavandería   del Sur ",
  timeZone: "America/Mexico_City",
  phoneCountryCode: "+52",
};

const SETTINGS = {
  name: "Bioclean Cozumel",
  timeZone: "America/Cancun",
  phoneCountryCode: "52",
  tagline: "Desde 1996",
};

const AREA = {
  center: HERE,
  bounds: { west: -87.06, south: 20.25, east: -86.7, north: 20.62 },
};

const NO_REMINDERS = { startDate: "", fromName: "", fromLocalPart: "", replyTo: "", whatsapp: null };

test("only the emails the operator listed can create a company, and it becomes theirs", async () => {
  const { t, asCreator, asOutsider, asDriver } = await setup();
  const create = (changes: Partial<typeof NEW_COMPANY> = {}) =>
    asCreator.mutation(api.companies.create, { ...NEW_COMPANY, ...changes });

  // Signed in with Google, but nobody gave this email access to anything.
  expect(await asOutsider.query(api.users.me)).toMatchObject({
    role: null,
    memberRole: null,
    can: [],
    company: null,
    canCreateCompany: false,
  });
  await expect(asOutsider.mutation(api.companies.create, NEW_COMPANY)).rejects.toThrow(
    "no está autorizado para crear una empresa",
  );
  await expect(t.mutation(api.companies.create, NEW_COMPANY)).rejects.toThrow("No tienes acceso");
  await expect(asDriver.mutation(api.companies.create, NEW_COMPANY)).rejects.toThrow(
    "ya pertenece a una empresa",
  );

  expect(await asCreator.query(api.users.me)).toMatchObject({
    memberRole: null,
    company: null,
    canCreateCompany: true,
  });
  await expect(create({ name: " " })).rejects.toThrow("Escribe el nombre de la empresa");
  await expect(create({ timeZone: "America/Cozumel" })).rejects.toThrow("zona horaria no es válida");
  await expect(create({ phoneCountryCode: "052" })).rejects.toThrow("clave de país");

  const companyId = await create();
  expect(await asCreator.query(api.users.me)).toMatchObject({
    role: "admin",
    memberRole: "owner",
    can: ["office", "manageUsers", "manageCompany"],
    company: {
      _id: companyId,
      name: "Lavandería del Sur",
      timeZone: "America/Mexico_City",
      phoneCountryCode: "52",
      serviceArea: null,
    },
    canCreateCompany: false,
  });
  // The new company starts empty, and its owner can already work in it.
  expect(await asCreator.query(api.clients.list, {})).toEqual([]);
  expect(await asCreator.query(api.members.list, {})).toHaveLength(1);

  // One company per email.
  await expect(create()).rejects.toThrow("ya pertenece a una empresa");
});

test("the list of who can create a company is read on every call", async () => {
  const { asCreator, asOutsider } = await setup();
  vi.stubEnv("COMPANY_CREATOR_EMAILS", "otra@example.com; NADIE@example.com");

  expect((await asCreator.query(api.users.me))?.canCreateCompany).toBe(false);
  await expect(asCreator.mutation(api.companies.create, NEW_COMPANY)).rejects.toThrow(
    "no está autorizado",
  );
  expect((await asOutsider.query(api.users.me))?.canCreateCompany).toBe(true);

  vi.stubEnv("COMPANY_CREATOR_EMAILS", "");
  expect((await asOutsider.query(api.users.me))?.canCreateCompany).toBe(false);
});

test("each role gets its own part of the app", async () => {
  const { asOwner, asAdmin, asOffice, asDriver } = await setup();
  const me = async (who: typeof asOwner) => {
    const { role, memberRole, can } = (await who.query(api.users.me))!;
    return { role, memberRole, can };
  };

  const everything = ["office", "manageUsers", "manageCompany"];
  expect(await me(asOwner)).toEqual({ role: "admin", memberRole: "owner", can: everything });
  expect(await me(asAdmin)).toEqual({ role: "admin", memberRole: "admin", can: everything });
  // The office does the day-to-day work but doesn't touch users or settings.
  expect(await me(asOffice)).toEqual({ role: "admin", memberRole: "office", can: ["office"] });
  expect(await me(asDriver)).toEqual({ role: "driver", memberRole: "driver", can: ["deliver"] });

  await asOffice.mutation(api.vehicles.create, { name: "Camioneta 1" });
  await asOffice.mutation(api.settings.setBase, { base: HERE });
  for (const who of [asOffice, asDriver]) {
    await expect(who.query(api.companies.get, {})).rejects.toThrow("Solo el administrador");
    await expect(who.mutation(api.companies.update, SETTINGS)).rejects.toThrow(
      "Solo el administrador",
    );
    await expect(who.mutation(api.companies.updateReminders, NO_REMINDERS)).rejects.toThrow(
      "Solo el administrador",
    );
    await expect(who.mutation(api.companies.setWhatsAppToken, { token: "" })).rejects.toThrow(
      "Solo el administrador",
    );
    await expect(who.action(api.reminders.testSender, {})).rejects.toThrow("Solo el administrador");
  }
  await expect(asDriver.query(api.settings.get, {})).rejects.toThrow("Solo el administrador");
});

test("a company's settings reach everyone in it, and nobody else", async () => {
  const { asAdmin, asDriver, asRivalAdmin } = await setup();
  const update = (changes: Partial<Parameters<typeof asAdmin.mutation<typeof api.companies.update>>[1]>) =>
    asAdmin.mutation(api.companies.update, { ...SETTINGS, ...changes });

  await expect(update({ name: "" })).rejects.toThrow("Escribe el nombre");
  await expect(update({ timeZone: "Hora de Cozumel" })).rejects.toThrow("zona horaria");
  await expect(
    update({ serviceArea: { ...AREA, bounds: { ...AREA.bounds, west: -86, east: -87 } } }),
  ).rejects.toThrow("zona de servicio no es válida");

  // Written however: the zone is saved as the time zone database names it.
  await update({ timeZone: " america/new_york ", serviceArea: AREA });
  const company = {
    name: "Bioclean Cozumel",
    timeZone: "America/New_York",
    phoneCountryCode: "52",
    serviceArea: AREA,
  };
  expect((await asDriver.query(api.users.me))?.company).toMatchObject(company);
  expect(await asAdmin.query(api.companies.get, {})).toMatchObject({ ...company, tagline: "Desde 1996" });
  expect(await asAdmin.query(api.settings.get, {})).toEqual({ base: null, serviceArea: AREA });

  // Saving without the service area leaves it as it was; null removes it.
  await update({});
  expect((await asAdmin.query(api.companies.get, {})).serviceArea).toEqual(AREA);
  await update({ serviceArea: null });
  expect((await asAdmin.query(api.companies.get, {})).serviceArea).toBeNull();

  expect(await asRivalAdmin.query(api.companies.get, {})).toMatchObject({
    name: "Limpieza Rival",
    timeZone: "America/Tijuana",
  });
});

test("a company sets up its own reminders, and its WhatsApp token can't be read back", async () => {
  const { t, companyId, otherCompanyId, asAdmin, asRivalAdmin } = await setup();
  const whatsapp = { phoneNumberId: "1234567890", templateVencimiento: "", templateProximo: "", lang: "" };
  const save = (changes: Partial<Parameters<typeof asAdmin.mutation<typeof api.companies.updateReminders>>[1]>) =>
    asAdmin.mutation(api.companies.updateReminders, { ...NO_REMINDERS, ...changes });

  await expect(save({ startDate: "01/01/2026" })).rejects.toThrow("fecha de inicio no es válida");
  await expect(save({ replyTo: "oficina@bioclean" })).rejects.toThrow("correo de respuesta");
  await expect(save({ fromLocalPart: "cobranza@otra.com" })).rejects.toThrow("dirección del remitente");
  await expect(save({ whatsapp: { ...whatsapp, phoneNumberId: "+52 987 123 4567" } })).rejects.toThrow(
    "identificador del número",
  );
  await expect(save({ whatsapp: { ...whatsapp, templateProximo: "Mi Plantilla" } })).rejects.toThrow(
    "plantilla",
  );

  await save({
    startDate: "2026-01-01",
    fromName: ' Cobranza "Bioclean" <x> ',
    fromLocalPart: " Cobranza ",
    replyTo: " Oficina@Bioclean.example ",
    whatsapp,
  });
  await expect(
    asAdmin.mutation(api.companies.setWhatsAppToken, { token: "corto" }),
  ).rejects.toThrow("no parece válido");
  const token = "EAAG-un-token-largo-de-meta-0123456789";
  await asAdmin.mutation(api.companies.setWhatsAppToken, { token: ` ${token} ` });

  const settings = await asAdmin.query(api.companies.get, {});
  expect(settings).toMatchObject({
    reminders: {
      startDate: "2026-01-01",
      fromName: "Cobranza Bioclean x",
      fromLocalPart: "cobranza",
      replyTo: "oficina@bioclean.example",
      whatsapp,
    },
    hasWhatsAppToken: true,
  });
  expect(JSON.stringify(settings)).not.toContain(token);
  expect(JSON.stringify(await asAdmin.query(api.users.me))).not.toContain(token);

  // Only the job that sends the messages gets it, with the default template names.
  expect(await t.query(internal.companies.reminderConfig, { companyId })).toMatchObject({
    companyName: "Bioclean Green Cozumel",
    timeZone: "America/Cancun",
    startDate: "2026-01-01",
    whatsapp: {
      token,
      phoneNumberId: "1234567890",
      templateVencimiento: "recordatorio_pago_vencimiento",
      templateProximo: "recordatorio_pago_proximo",
      lang: "es_MX",
    },
  });
  // The other company has none of it.
  expect(await asRivalAdmin.query(api.companies.get, {})).toMatchObject({
    reminders: NO_REMINDERS,
    hasWhatsAppToken: false,
  });
  expect(
    await t.query(internal.companies.reminderConfig, { companyId: otherCompanyId }),
  ).toMatchObject({ startDate: null, whatsapp: null });

  // Removing the token turns WhatsApp off.
  await asAdmin.mutation(api.companies.setWhatsAppToken, { token: "" });
  expect((await asAdmin.query(api.companies.get, {})).hasWhatsAppToken).toBe(false);
  expect(
    (await t.query(internal.companies.reminderConfig, { companyId }))!.whatsapp,
  ).toBeNull();
});

test("a company never chooses the domain its emails come from", async () => {
  const { t, companyId, otherCompanyId, asAdmin } = await setup();
  const sender = async () => (await asAdmin.query(api.companies.get, {})).sender;
  const save = (changes: Partial<typeof NO_REMINDERS>) =>
    asAdmin.mutation(api.companies.updateReminders, { ...NO_REMINDERS, ...changes });

  // No domain of its own and no shared address configured: email isn't available.
  expect(await sender()).toEqual({ from: null, error: expect.stringContaining("no están activados") });

  // On the shared address, clients have to be able to answer the company.
  vi.stubEnv("REMINDER_DEFAULT_FROM_EMAIL", "Deliverado <avisos@deliverado.example>");
  expect(await sender()).toEqual({ from: null, error: expect.stringContaining("correo de respuesta") });
  await save({ replyTo: "oficina@bioclean.example", fromLocalPart: "cobranza" });
  expect(await sender()).toEqual({
    from: '"Bioclean Green Cozumel" <avisos@deliverado.example>',
    error: null,
  });
  expect(await asAdmin.query(api.companies.get, {})).toMatchObject({
    senderDomain: null,
    sharedAddress: "avisos@deliverado.example",
  });

  // Once the operator verifies the company's domain, it sends from there.
  await expect(
    t.mutation(internal.companies.setSenderDomain, { companyId, senderDomain: "no es un dominio" }),
  ).rejects.toThrow("no es un dominio");
  await t.mutation(internal.companies.setSenderDomain, { companyId, senderDomain: "Bioclean.example" });
  await save({ fromName: "Cobranza Bioclean", fromLocalPart: "cobranza" });
  expect(await sender()).toEqual({ from: '"Cobranza Bioclean" <cobranza@bioclean.example>', error: null });
  await save({});
  expect(await sender()).toEqual({
    from: '"Bioclean Green Cozumel" <avisos@bioclean.example>',
    error: null,
  });

  // A domain is one company's only.
  await expect(
    t.mutation(internal.companies.setSenderDomain, {
      companyId: otherCompanyId,
      senderDomain: "bioclean.example",
    }),
  ).rejects.toThrow("ya es el dominio");
  expect(await t.query(internal.companies.list, {})).toMatchObject([
    { name: "Bioclean Green Cozumel", owner: "duena@example.com", members: 5, senderDomain: "bioclean.example" },
    { name: "Limpieza Rival", owner: "oficina@rival.example", members: 2, senderDomain: null },
  ]);
});

test("an admin can send themselves a sample email to check the sender", async () => {
  const { t, companyId, asAdmin } = await setup();
  vi.stubEnv("RESEND_API_KEY", "re_test");
  const send = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}"));
  vi.stubGlobal("fetch", send);

  await expect(asAdmin.action(api.reminders.testSender, {})).rejects.toThrow("no están activados");
  expect(send).not.toHaveBeenCalled();

  await t.mutation(internal.companies.setSenderDomain, { companyId, senderDomain: "bioclean.example" });
  await asAdmin.mutation(api.companies.update, SETTINGS);
  expect(await asAdmin.action(api.reminders.testSender, {})).toEqual({ to: ADMIN_EMAIL });

  expect(send).toHaveBeenCalledOnce();
  const [url, init] = send.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  const body = JSON.parse(init.body as string);
  expect(body).toMatchObject({
    from: '"Bioclean Cozumel" <avisos@bioclean.example>',
    to: [ADMIN_EMAIL],
    subject: expect.stringContaining("[Prueba]"),
  });
  expect(body.html).toContain("Bioclean Cozumel");
  expect(body.html).toContain("Desde 1996");
  // A sample isn't a reminder to a client: nothing is logged.
  expect(await t.run(async (ctx) => await ctx.db.query("reminders").collect())).toEqual([]);

  // What Resend answers is shown to the admin.
  send.mockResolvedValueOnce(new Response('{"message":"domain is not verified"}', { status: 403 }));
  await expect(asAdmin.action(api.reminders.testSender, {})).rejects.toThrow(
    "Resend respondió 403",
  );
});
