import { expect, test } from "vitest";
import { emptyDraft, type Draft } from "./draft";
import { clientStepMissing, signatureIsCurrent, signedContentKey } from "./signature";

const unsigned = (): Draft => ({
  ...emptyDraft(),
  clientName: "Hotel Cozumel",
  invoices: [{ number: "F-1" }],
  payment: "credito",
  notes: "Dejé la mercancía en recepción",
  status: "exitosa",
});

/** The draft as it is right after the client signs it. */
const sign = (d: Draft): Draft => ({
  ...d,
  signature: { image: new Blob(["firma"]), signedAt: 1, signedFor: signedContentKey(d) },
});

test("a signature counts while what the client signed stays the same", () => {
  expect(signatureIsCurrent(unsigned())).toBe(false);
  expect(signatureIsCurrent(sign(unsigned()))).toBe(true);
});

test.each<[string, Partial<Draft>]>([
  ["the client", { clientName: "Otro Hotel" }],
  ["a factura number", { invoices: [{ number: "F-2" }] }],
  ["the number of facturas", { invoices: [{ number: "F-1" }, { number: "F-2" }] }],
  ["the payment", { payment: "pagado" }],
  ["the driver's notes", { notes: "" }],
  ["the client's answer", { status: "faltante", clientNotes: "Faltó una caja" }],
])("changing %s after signing means signing again", (_what, change) => {
  expect(signatureIsCurrent({ ...sign(unsigned()), ...change })).toBe(false);
});

test("changes that don't alter what was signed keep the signature", () => {
  const signed = sign(unsigned());
  expect(signatureIsCurrent({ ...signed, clientName: " Hotel Cozumel " })).toBe(true);
  expect(signatureIsCurrent({ ...signed, invoices: [{ number: " f-1" }] })).toBe(true);
  // The explanation is hidden (and not sent) when the delivery went well.
  expect(signatureIsCurrent({ ...signed, clientNotes: "texto que quedó de antes" })).toBe(true);
});

test("the client's explanation of a problem is part of what they sign", () => {
  const signed = sign({ ...unsigned(), status: "faltante", clientNotes: "Faltó una caja" });
  expect(signatureIsCurrent(signed)).toBe(true);
  expect(signatureIsCurrent({ ...signed, clientNotes: "Faltaron dos cajas" })).toBe(false);
});

test("the client answers first, explains any problem, and then signs", () => {
  const noAnswer: Draft = { ...unsigned(), status: undefined };
  expect(clientStepMissing(noAnswer)).toBe("answer");

  const problem: Draft = { ...unsigned(), status: "faltante" };
  expect(clientStepMissing(problem)).toBe("answer");

  const explained: Draft = { ...problem, clientNotes: "Faltó una caja" };
  expect(clientStepMissing(explained)).toBe("signature");
  expect(clientStepMissing(sign(explained))).toBeNull();
});
