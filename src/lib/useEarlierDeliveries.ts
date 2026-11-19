import { useQuery } from "convex/react";
import { useRef } from "react";
import { api } from "../../convex/_generated/api";
import { cleanInvoice, normalizeKey } from "../../convex/lib/text";
import type { Draft, DraftInvoice } from "./draft";
import { itemInvoices } from "./outbox";
import { useOutbox } from "./OutboxProvider";
import type { DeliveryStatus } from "./status";

type ClientRef = { clientId?: string; clientName: string };

/** A delivery that already has a factura number the driver is entering. */
export type EarlierDelivery = {
  clientName: string;
  createdAt: number;
  status: DeliveryStatus;
  /** Missing when it's one of this driver's own, still waiting on the phone. */
  driverName?: string;
  /** Whether it was for the client of the delivery being registered. */
  sameClient: boolean;
};

type Candidate = Omit<EarlierDelivery, "sameClient"> & { clientId?: string };

/** A client typed by hand has no id until the delivery uploads; then the name decides. */
function isSameClient(a: ClientRef, b: ClientRef): boolean {
  return a.clientId && b.clientId
    ? a.clientId === b.clientId
    : normalizeKey(a.clientName) === normalizeKey(b.clientName);
}

/**
 * A factura already in another delivery stops the wizard unless that delivery
 * was for the same client and the driver confirmed this one follows it up. A
 * "no" keeps blocking even if the lookup is lost (e.g. the signal drops) until
 * the number is changed.
 */
export function needsFollowUpAnswer(invoice: DraftInvoice, earlier: EarlierDelivery | null): boolean {
  if (invoice.followUp === false) return true;
  return earlier !== null && (!earlier.sameClient || invoice.followUp !== true);
}

/**
 * For each factura of the draft, the delivery that already has its number, or
 * null when none is known: the latest one for the draft's client if there is
 * one (the only kind that can be followed up), else the latest one. Without
 * signal only the deliveries waiting on this phone are known; the server marks
 * the rest when the delivery uploads.
 */
export function useEarlierDeliveries(
  draft: Pick<Draft, "clientId" | "clientName" | "invoices"> | null,
): (EarlierDelivery | null)[] {
  const numbers = (draft?.invoices ?? []).map((i) => cleanInvoice(i.number));
  const wanted = [...new Set(numbers.filter(Boolean))].sort();
  const result = useQuery(
    api.deliveries.findByInvoices,
    wanted.length > 0 ? { numbers: wanted } : "skip",
  );

  // The query reloads whenever any number changes; keep the last answer for
  // each one so the question doesn't blink while another factura is typed.
  const known = useRef(new Map<string, Candidate[]>());
  result?.forEach((r) => known.current.set(r.number, r.earlier));

  const waiting = useOutbox()?.items ?? [];

  if (!draft) return [];
  return numbers.map((number) => {
    if (!number) return null;
    const candidates: Candidate[] = [
      ...(known.current.get(number) ?? []),
      ...waiting
        .filter((w) => itemInvoices(w).some((i) => cleanInvoice(i.number) === number))
        .map((w) => ({
          clientId: w.clientId,
          clientName: w.clientName,
          createdAt: w.deliveredAt,
          status: w.status,
        })),
    ];
    const same = candidates.find((c) => isSameClient(c, draft));
    const picked = same ?? candidates[0];
    if (!picked) return null;
    const { clientId: _, ...delivery } = picked;
    return { ...delivery, sameClient: same !== undefined };
  });
}
