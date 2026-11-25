import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { draftHasContent, emptyDraft, upgrade, type Draft, type DraftV1 } from "./draft";
import { outboxItemFromDraft } from "./outbox";

const HERE = { lat: 20.5, lng: -86.95 };
const blob = (name: string) => new Blob([name]);

test("a draft saved when a delivery had a single factura is still usable", () => {
  const invoice = blob("factura");
  const receiver = blob("recibe");
  // What that app version stored: one factura, its photo with the others, no client notes.
  const old = {
    step: 4,
    clientName: "HOTEL COZUMEL",
    invoiceNumber: "F-1",
    photos: { invoice, receiver },
    location: HERE,
    notes: "nota",
    updatedAt: 1,
  } as unknown as DraftV1;

  expect(upgrade(old)).toEqual({
    version: 2,
    step: 0,
    clientName: "HOTEL COZUMEL",
    invoices: [{ number: "F-1", photo: invoice }],
    photos: { receiver, goods: undefined },
    location: HERE,
    locationSource: "modificada",
    notes: "nota",
    clientNotes: "",
    updatedAt: 1,
  });
});

test("a draft saved before the client answered on the phone gets empty client notes", () => {
  const { clientNotes: _, ...saved } = { ...emptyDraft(), clientName: "HOTEL", step: 3 };
  expect(upgrade(saved as Draft)).toMatchObject({ clientName: "HOTEL", step: 3, clientNotes: "" });
});

test("only what the driver entered makes a draft worth resuming", () => {
  const vehicle = { _id: "v1" as Id<"vehicles">, name: "Camioneta" };
  expect(draftHasContent(emptyDraft(vehicle))).toBe(false);
  expect(draftHasContent({ ...emptyDraft(), invoices: [{ number: "", photo: blob("f") }] })).toBe(true);
  expect(draftHasContent({ ...emptyDraft(), clientNotes: "Faltó una caja" })).toBe(true);
});

const finished = (): Draft => ({
  ...emptyDraft(),
  clientName: "HOTEL COZUMEL",
  invoices: [
    { number: "F-1", photo: blob("f1"), followUp: true },
    { number: "F-2", photo: blob("f2"), followUp: false },
  ],
  photos: { receiver: blob("recibe"), goods: blob("mercancía") },
  location: HERE,
  locationSource: "guardada",
  driverPosition: { lat: 20.6, lng: -86.9 },
  status: "exitosa",
  payment: "pagado",
  clientNotes: "texto que quedó de antes",
  signature: { image: blob("firma"), signedAt: 5, signedFor: "" },
});

test("a finished draft becomes an upload with its own id and the photos' bytes", async () => {
  const item = await outboxItemFromDraft(finished(), "user1");
  const again = await outboxItemFromDraft(finished(), "user1");

  expect(item.id).not.toBe(again.id);
  expect(item.invoices).toEqual([
    { number: "F-1", photo: { bytes: expect.any(ArrayBuffer), type: "image/jpeg" }, followUp: true },
    { number: "F-2", photo: { bytes: expect.any(ArrayBuffer), type: "image/jpeg" } },
  ]);
  expect(item.signature).toMatchObject({ signedAt: 5 });
  // Nothing the client wrote is sent when the delivery went well.
  expect(item.clientNotes).toBe("");
});

test("the driver's own position is sent only when they confirmed the saved location", async () => {
  const confirmed = await outboxItemFromDraft(finished(), "user1");
  expect(confirmed.driverPosition).toEqual({ lat: 20.6, lng: -86.9 });

  const moved = await outboxItemFromDraft({ ...finished(), locationSource: "modificada" }, "user1");
  expect(moved.driverPosition).toBeUndefined();
});
