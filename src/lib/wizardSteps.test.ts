import { expect, test } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";
import { emptyDraft, type Draft } from "./draft";
import { signedContentKey } from "./signature";
import { needsFollowUpAnswer, type EarlierDelivery } from "./useEarlierDeliveries";
import type { Vehicle } from "./useVehicleList";
import { invoicesValid, isStepValid } from "./wizardSteps";

const photo = new Blob(["foto"]);

/** Everything the driver enters before handing the phone to the client. */
const filled = (): Draft => ({
  ...emptyDraft(),
  clientName: "Hotel Cozumel",
  invoices: [{ number: "F-1", photo }],
  photos: { receiver: photo, goods: photo },
  location: { lat: 20.5, lng: -86.95 },
  locationSource: "nueva",
  payment: "pagado",
});

/** A delivery that already has the factura number being entered. */
const earlier = (sameClient: boolean): EarlierDelivery => ({
  clientName: "Hotel Cozumel",
  createdAt: 1,
  status: "exitosa",
  sameClient,
});

test("every factura needs a number and a photo, and no number can repeat", () => {
  expect(invoicesValid(filled(), [])).toBe(true);
  expect(invoicesValid({ ...filled(), invoices: [] }, [])).toBe(false);
  expect(invoicesValid({ ...filled(), invoices: [{ number: "F-1" }] }, [])).toBe(false);
  expect(invoicesValid({ ...filled(), invoices: [{ number: "  ", photo }] }, [])).toBe(false);
  const repeated = [
    { number: "f 1", photo },
    { number: "F1", photo },
  ];
  expect(invoicesValid({ ...filled(), invoices: repeated }, [])).toBe(false);
});

test("a factura already delivered to the same client needs the driver to confirm it's a follow-up", () => {
  expect(needsFollowUpAnswer({ number: "F-1" }, null)).toBe(false);
  expect(needsFollowUpAnswer({ number: "F-1" }, earlier(true))).toBe(true);
  expect(needsFollowUpAnswer({ number: "F-1", followUp: true }, earlier(true))).toBe(false);
  expect(invoicesValid(filled(), [earlier(true)])).toBe(false);
});

test("a factura already delivered to another client can never be a follow-up", () => {
  expect(needsFollowUpAnswer({ number: "F-1", followUp: true }, earlier(false))).toBe(true);
});

test("answering that it isn't a follow-up keeps blocking, even without signal", () => {
  expect(needsFollowUpAnswer({ number: "F-1", followUp: false }, null)).toBe(true);
});

test("the vehicle is required only when there are vehicles to choose from", () => {
  const vehicles = [{ _id: "v1" as Id<"vehicles">, name: "Camioneta", active: true }] as Vehicle[];
  expect(isStepValid("vehicle", filled(), undefined, [])).toBe(true);
  expect(isStepValid("vehicle", filled(), [], [])).toBe(true);
  expect(isStepValid("vehicle", filled(), vehicles, [])).toBe(false);
  expect(isStepValid("vehicle", { ...filled(), vehicleId: vehicles[0]._id }, vehicles, [])).toBe(true);
});

test.each<[string, Partial<Draft>]>([
  ["the client", { clientName: " " }],
  ["a factura photo", { invoices: [{ number: "F-1" }] }],
  ["the photo of the goods", { photos: { receiver: photo } }],
  ["the photo of who receives", { photos: { goods: photo } }],
  ["the location", { location: undefined }],
  ["the payment", { payment: undefined }],
])("the driver can't reach the client's screen without %s", (_what, missing) => {
  expect(isStepValid("review", filled(), undefined, [])).toBe(true);
  expect(isStepValid("review", { ...filled(), ...missing }, undefined, [])).toBe(false);
});

test("a delivery is confirmed only with the client's answer and a signature for what's on screen", () => {
  const answered: Draft = { ...filled(), status: "exitosa" };
  expect(isStepValid("signature", filled(), undefined, [])).toBe(false);
  expect(isStepValid("signature", answered, undefined, [])).toBe(false);

  const signed: Draft = {
    ...answered,
    signature: { image: photo, signedAt: 1, signedFor: signedContentKey(answered) },
  };
  expect(isStepValid("signature", signed, undefined, [])).toBe(true);
  expect(isStepValid("signature", { ...signed, payment: "credito" }, undefined, [])).toBe(false);
});
