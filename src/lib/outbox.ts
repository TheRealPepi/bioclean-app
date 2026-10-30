import { createStore, del, get, set, values, type UseStore } from "idb-keyval";
import type { Id } from "../../convex/_generated/dataModel";
import type { Draft, PhotoKey } from "./draft";
import type { DeliveryStatus } from "./status";

/**
 * A finished delivery saved on the phone and waiting to be uploaded. Every
 * delivery goes through here, with or without signal; OutboxProvider uploads
 * them and removes each one only after the server confirmed it.
 */
export type OutboxItem = {
  /** Also sent as `clientRequestId`, so a retried upload is never saved twice. */
  id: string;
  userId: string;
  deliveredAt: number;
  clientId?: Id<"clients">;
  clientName: string;
  invoiceNumber: string;
  photos: Record<PhotoKey, Blob>;
  /** Photos already uploaded, so a retry only uploads the missing ones. */
  photoIds: Partial<Record<PhotoKey, Id<"_storage">>>;
  location: { lat: number; lng: number; accuracy?: number };
  status: DeliveryStatus;
  notes: string;
  /** Set when the server rejected it; it then waits for the driver to retry. */
  error?: string;
};

// Unlike drafts, storage errors here are not ignored: the wizard must tell the
// driver if a delivery could not be saved.
let store: UseStore | undefined;
const outboxStore = () => (store ??= createStore("bioclean-outbox", "items"));

export function outboxItemFromDraft(draft: Draft, userId: string): OutboxItem {
  return {
    id: crypto.randomUUID(),
    userId,
    deliveredAt: Date.now(),
    clientId: draft.clientId,
    clientName: draft.clientName,
    invoiceNumber: draft.invoiceNumber,
    photos: draft.photos as Record<PhotoKey, Blob>,
    photoIds: {},
    location: draft.location!,
    status: draft.status!,
    notes: draft.notes,
  };
}

export async function addToOutbox(item: OutboxItem): Promise<void> {
  await set(item.id, item, outboxStore());
}

/** The user's waiting deliveries, oldest first (the order they're uploaded in). */
export async function listOutbox(userId: string): Promise<OutboxItem[]> {
  const items = await values<OutboxItem>(outboxStore());
  return items.filter((i) => i.userId === userId).sort((a, b) => a.deliveredAt - b.deliveredAt);
}

export async function updateOutboxItem(id: string, changes: Partial<OutboxItem>): Promise<void> {
  const item = await get<OutboxItem>(id, outboxStore());
  // Skip if it was uploaded meanwhile (e.g. from another tab).
  if (item) await set(id, { ...item, ...changes }, outboxStore());
}

export async function removeFromOutbox(id: string): Promise<void> {
  await del(id, outboxStore());
}
