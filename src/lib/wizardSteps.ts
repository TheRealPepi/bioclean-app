// The steps of the new-delivery wizard and what each one needs before the
// driver (or, on the last one, the client) can go on.
import { cleanInvoice } from "../../convex/lib/text";
import type { Draft, PhotoKey } from "./draft";
import { clientStepMissing } from "./signature";
import { needsFollowUpAnswer, type EarlierDelivery } from "./useEarlierDeliveries";
import type { Vehicle } from "./useVehicleList";

export type StepKey =
  | "client"
  | "vehicle"
  | "invoices"
  | "receiverPhoto"
  | "goodsPhoto"
  | "location"
  | "payment"
  | "notes"
  | "review"
  | "signature";

export const STEPS: { key: StepKey; title: string; hint?: string }[] = [
  { key: "client", title: "Cliente", hint: "Elige el cliente de la lista o escribe uno nuevo." },
  { key: "vehicle", title: "Vehículo", hint: "¿En qué vehículo haces esta entrega?" },
  {
    key: "invoices",
    title: "Facturas",
    hint: "Número y foto de cada factura. Que se lean el número y la firma.",
  },
  // Goods first: the person receiving often shows up later.
  { key: "goodsPhoto", title: "Foto de la mercancía", hint: "La mercancía entregada." },
  { key: "receiverPhoto", title: "Foto de quien recibe", hint: "La persona que recibe la mercancía." },
  { key: "location", title: "Ubicación de entrega" },
  { key: "payment", title: "Pago", hint: "¿La entrega quedó pagada o es a crédito?" },
  {
    key: "notes",
    title: "Anotaciones",
    hint: "Opcional: cualquier detalle que quieras dejar registrado.",
  },
  {
    key: "review",
    title: "Revisa la entrega",
    hint: "Después pásale el teléfono al cliente para que responda, firme y toque «Confirmar entrega».",
  },
  // Shown to the client: they say how the delivery went, then sign. One
  // screen, so they can't stop halfway and hand the phone back.
  // Speaks to the client directly, so neither side mistakes whose turn it is.
  { key: "signature", title: "Cliente: confirme su entrega" },
];

export const PHOTO_STEPS: Partial<Record<StepKey, PhotoKey>> = {
  receiverPhoto: "receiver",
  goodsPhoto: "goods",
};

export function invoicesValid(d: Draft, earlier: (EarlierDelivery | null)[]): boolean {
  const numbers = d.invoices.map((i) => cleanInvoice(i.number));
  return (
    d.invoices.length > 0 &&
    d.invoices.every((i) => i.photo !== undefined) &&
    numbers.every(Boolean) &&
    new Set(numbers).size === numbers.length &&
    d.invoices.every((invoice, i) => !needsFollowUpAnswer(invoice, earlier[i] ?? null))
  );
}

export function isStepValid(
  key: StepKey,
  d: Draft,
  vehicles: Vehicle[] | undefined,
  earlier: (EarlierDelivery | null)[],
): boolean {
  switch (key) {
    case "client":
      return d.clientName.trim() !== "";
    case "vehicle":
      // Never blocks when there's no list (not downloaded yet, or none added).
      return !vehicles?.length || vehicles.some((v) => v._id === d.vehicleId);
    case "invoices":
      return invoicesValid(d, earlier);
    case "receiverPhoto":
    case "goodsPhoto":
      return d.photos[PHOTO_STEPS[key]!] !== undefined;
    case "location":
      return d.location !== undefined && d.locationSource !== undefined;
    case "payment":
      return d.payment !== undefined;
    case "notes":
      return true;
    case "review":
      return STEPS.filter((s) => s.key !== "review" && s.key !== "signature").every((s) =>
        isStepValid(s.key, d, vehicles, earlier),
      );
    case "signature":
      return isStepValid("review", d, vehicles, earlier) && clientStepMissing(d) === null;
  }
}
