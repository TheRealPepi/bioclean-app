import type { CSSProperties } from "react";
import type { Doc } from "../../convex/_generated/dataModel";

/** See `invoiceRepeat` in convex/schema.ts. */
export type InvoiceRepeat = NonNullable<
  NonNullable<Doc<"deliveries">["invoices"]>[number]["repeat"]
>;

export const REPEAT_META: Record<InvoiceRepeat, { label: string; fg: string; bg: string }> = {
  seguimiento: { label: "Seguimiento", fg: "#475569", bg: "#e2e8f0" },
  posible_duplicado: { label: "Posible duplicado", fg: "#b45309", bg: "#fef3c7" },
};

/** Same CSS custom properties as the status badge, so it can reuse its styles. */
export function repeatStyle(repeat: InvoiceRepeat): CSSProperties {
  const meta = REPEAT_META[repeat];
  return { "--status-fg": meta.fg, "--status-bg": meta.bg } as CSSProperties;
}
