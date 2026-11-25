import { cleanInvoice } from "../../convex/lib/text";
import type { Draft } from "./draft";

/**
 * What the client agrees to when signing: everything shown on the client's
 * screen, including their own answer about how the delivery went (chosen right
 * before signing). If any of it changes afterwards, the key changes and the
 * client has to sign again.
 */
export function signedContentKey(d: Draft): string {
  return JSON.stringify([
    d.clientName.trim(),
    d.invoices.map((i) => cleanInvoice(i.number)),
    d.payment ?? null,
    d.notes.trim(),
    d.status ?? null,
    d.status === "exitosa" ? "" : d.clientNotes.trim(),
  ]);
}

/** The draft has a signature, and nothing it was signed for changed since. */
export function signatureIsCurrent(d: Draft): boolean {
  return d.signature !== undefined && d.signature.signedFor === signedContentKey(d);
}

/** The client said how the delivery went (and, if there was a problem, what happened). */
export function answerComplete(d: Draft): boolean {
  return d.status !== undefined && (d.status === "exitosa" || d.clientNotes.trim() !== "");
}

/** What the client still has to do on their screen, in order; null when done. */
export function clientStepMissing(d: Draft): "answer" | "signature" | null {
  if (!answerComplete(d)) return "answer";
  if (!signatureIsCurrent(d)) return "signature";
  return null;
}
