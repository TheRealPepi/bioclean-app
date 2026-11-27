import { expect, test } from "vitest";
import { cleanInvoice, cleanPhone, isEmail, isPhone, normalizeKey } from "./text";

test("a factura number ignores spaces and letter case", () => {
  expect(cleanInvoice("  a 123 b ")).toBe("A123B");
  expect(cleanInvoice("   ")).toBe("");
});

test("client names that differ only by accents, punctuation or spacing share a key", () => {
  expect(normalizeKey("Hotel  Cozumél, S.A.")).toBe("HOTEL COZUMEL SA");
  expect(normalizeKey("hotel cozumel sa")).toBe("HOTEL COZUMEL SA");
  expect(normalizeKey("Hotel Cozumel 2")).not.toBe(normalizeKey("Hotel Cozumel"));
  expect(normalizeKey(" .,- ")).toBe("");
});

test("a 10-digit WhatsApp number is taken as one of the company's country", () => {
  expect(cleanPhone("987 123 4567", "52")).toBe("529871234567");
  expect(cleanPhone("+52 (987) 123-4567", "52")).toBe("529871234567");
  expect(cleanPhone("+1 305 555 0100", "52")).toBe("13055550100");
  expect(cleanPhone("305 555 0100", "1")).toBe("13055550100");
});

test("a WhatsApp number needs a country code and enough digits", () => {
  expect(isPhone("529871234567")).toBe(true);
  expect(isPhone("9871234")).toBe(false);
  expect(isPhone("029871234567")).toBe(false);
});

test("an email needs a name, an @ and a domain with a dot", () => {
  expect(isEmail("pagos@hotel.mx")).toBe(true);
  expect(isEmail("pagos@hotel")).toBe(false);
  expect(isEmail("pagos hotel@hotel.mx")).toBe(false);
});
