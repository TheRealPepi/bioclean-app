import type { CSSProperties } from "react";
import type { Doc } from "../../convex/_generated/dataModel";

export type Payment = NonNullable<Doc<"deliveries">["payment"]>;
export type LocationSource = NonNullable<Doc<"deliveries">["locationSource"]>;

type PaymentMeta = { label: string; fg: string; bg: string; rgb: [number, number, number] };

export const PAYMENT_META: Record<Payment, PaymentMeta> = {
  pagado: { label: "Pagado", fg: "#15803d", bg: "#dcfce7", rgb: [21, 128, 61] },
  credito: { label: "Crédito", fg: "#b45309", bg: "#fef3c7", rgb: [180, 83, 9] },
};

export const PAYMENTS = Object.keys(PAYMENT_META) as Payment[];

export function isPayment(value: string | null): value is Payment {
  return value !== null && value in PAYMENT_META;
}

/** Same CSS custom properties as the status badge, so it can reuse its styles. */
export function paymentStyle(payment: Payment): CSSProperties {
  const meta = PAYMENT_META[payment];
  return { "--status-fg": meta.fg, "--status-bg": meta.bg } as CSSProperties;
}

export const LOCATION_SOURCE_LABEL: Record<LocationSource, string> = {
  guardada: "Ubicación guardada del cliente",
  modificada: "Ubicación modificada en esta entrega",
  nueva: "Primera ubicación del cliente",
};

/** Short form for the CSV. */
export const LOCATION_SOURCE_SHORT: Record<LocationSource, string> = {
  guardada: "Guardada",
  modificada: "Modificada",
  nueva: "Nueva",
};
