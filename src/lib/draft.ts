import { del, get, set } from "idb-keyval";
import type { Id } from "../../convex/_generated/dataModel";
import type { DeliveryStatus } from "./status";

export type PhotoKey = "invoice" | "receiver" | "goods";

export type Draft = {
  step: number;
  clientId?: Id<"clients">;
  clientName: string;
  invoiceNumber: string;
  photos: Partial<Record<PhotoKey, Blob>>;
  location?: { lat: number; lng: number; accuracy?: number };
  status?: DeliveryStatus;
  notes: string;
  updatedAt: number;
};

export const emptyDraft = (): Draft => ({
  step: 0,
  clientName: "",
  invoiceNumber: "",
  photos: {},
  notes: "",
  updatedAt: Date.now(),
});

// Drafts live in IndexedDB (photos included) so a closed tab or lost signal
// doesn't lose the driver's progress. Storage failures (e.g. private mode)
// are ignored: the wizard still works, just without resume.
const key = (userId: string) => `bioclean-draft:${userId}`;

export async function loadDraft(userId: string): Promise<Draft | null> {
  try {
    return (await get<Draft>(key(userId))) ?? null;
  } catch {
    return null;
  }
}

export async function saveDraft(userId: string, draft: Draft): Promise<void> {
  try {
    await set(key(userId), draft);
  } catch {
    // ignore
  }
}

export async function clearDraft(userId: string): Promise<void> {
  try {
    await del(key(userId));
  } catch {
    // ignore
  }
}

export function draftHasContent(draft: Draft): boolean {
  return Boolean(
    draft.clientName ||
      draft.invoiceNumber ||
      Object.keys(draft.photos).length ||
      draft.location ||
      draft.status ||
      draft.notes,
  );
}
