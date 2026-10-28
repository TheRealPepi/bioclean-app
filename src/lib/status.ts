import type { CSSProperties } from "react";
import type { Doc } from "../../convex/_generated/dataModel";

export type DeliveryStatus = Doc<"deliveries">["status"];

type StatusMeta = { label: string; fg: string; bg: string; rgb: [number, number, number] };

export const STATUS_META: Record<DeliveryStatus, StatusMeta> = {
  exitosa: { label: "Entrega exitosa", fg: "#15803d", bg: "#dcfce7", rgb: [21, 128, 61] },
  faltante: { label: "Mercancía faltante", fg: "#b45309", bg: "#fef3c7", rgb: [180, 83, 9] },
  cambio_mercancia: {
    label: "Cambio de mercancía",
    fg: "#1d4ed8",
    bg: "#dbeafe",
    rgb: [29, 78, 216],
  },
  cambio_factura: { label: "Cambio de factura", fg: "#7e22ce", bg: "#f3e8ff", rgb: [126, 34, 206] },
  no_recibido: { label: "No se recibió material", fg: "#b91c1c", bg: "#fee2e2", rgb: [185, 28, 28] },
};

export const STATUSES = Object.keys(STATUS_META) as DeliveryStatus[];

export function isStatus(value: string | null): value is DeliveryStatus {
  return value !== null && value in STATUS_META;
}

/** CSS custom properties consumed by status-colored components. */
export function statusStyle(status: DeliveryStatus): CSSProperties {
  const meta = STATUS_META[status];
  return { "--status-fg": meta.fg, "--status-bg": meta.bg } as CSSProperties;
}
