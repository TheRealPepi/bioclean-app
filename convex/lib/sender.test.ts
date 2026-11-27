import { expect, test } from "vitest";
import { addressOf, cleanSenderName, emailSender, isDomain, isLocalPart } from "./sender";

const SHARED = "Deliverado <avisos@deliverado.example>";

test("a company with its own domain sends from it, under the name it chose", () => {
  expect(
    emailSender(
      {
        name: "Bioclean Green Cozumel",
        senderDomain: "bioclean.example",
        reminders: { fromName: "Cobranza", fromLocalPart: "cobranza", replyTo: "oficina@bioclean.example" },
      },
      SHARED,
    ),
  ).toEqual({
    from: '"Cobranza" <cobranza@bioclean.example>',
    replyTo: "oficina@bioclean.example",
    shared: false,
  });
  // With nothing chosen: the company's name, and "avisos@".
  expect(emailSender({ name: "Bioclean", senderDomain: "bioclean.example" }, undefined)).toEqual({
    from: '"Bioclean" <avisos@bioclean.example>',
    replyTo: undefined,
    shared: false,
  });
});

test("a company without a domain sends from the shared address, and needs a reply-to", () => {
  const company = { name: "Lavandería del Sur", reminders: { fromLocalPart: "loquesea" } };

  expect(emailSender(company, undefined)).toEqual({ error: expect.stringContaining("no están activados") });
  expect(emailSender(company, "no es un correo")).toEqual({
    error: expect.stringContaining("no están activados"),
  });
  expect(emailSender(company, SHARED)).toEqual({ error: expect.stringContaining("correo de respuesta") });
  expect(
    emailSender({ ...company, reminders: { replyTo: "hola@lavanderia.example" } }, SHARED),
  ).toEqual({
    from: '"Lavandería del Sur" <avisos@deliverado.example>',
    replyTo: "hola@lavanderia.example",
    shared: true,
  });
});

test("nothing a company types can change the address or add another one", () => {
  expect(cleanSenderName(' Cobranza "Sur" <jefe@otra.com>\r\nBcc: x ')).toBe(
    "Cobranza Sur jefe@otra.com Bcc: x",
  );
  expect(isLocalPart("cobranza.sur-1")).toBe(true);
  for (const bad of ["", "cobranza@otra.com", "a b", "a..b", ".a", "Cobranza", "a>"]) {
    expect(isLocalPart(bad), bad).toBe(false);
  }
  expect(isDomain("avisos.bioclean.com.mx")).toBe(true);
  for (const bad of ["bioclean", "bioclean.com/x", "a@b.com", "-a.com", "a b.com"]) {
    expect(isDomain(bad), bad).toBe(false);
  }
});

test("the shared address is read from either way of writing it", () => {
  expect(addressOf("Deliverado <Avisos@Deliverado.example>")).toBe("avisos@deliverado.example");
  expect(addressOf(" avisos@deliverado.example ")).toBe("avisos@deliverado.example");
  expect(addressOf("Deliverado")).toBeNull();
  expect(addressOf(undefined)).toBeNull();
});
