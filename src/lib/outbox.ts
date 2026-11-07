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
  photos: Record<PhotoKey, StoredPhoto>;
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

/**
 * A photo's raw bytes. Items saved by older versions hold a Blob instead: on
 * iPhone, a Blob read back from IndexedDB can fail when sent with fetch ("The
 * network connection was lost"), so new items store the bytes themselves.
 */
export type StoredPhoto = { bytes: ArrayBuffer; type: string } | Blob;

/** A photo saved on the phone can no longer be read. Retrying won't help. */
export class PhotoReadError extends Error {
  constructor() {
    super("No se pudo leer una foto guardada en el teléfono.");
  }
}

export async function photoBytes(photo: StoredPhoto): Promise<{ bytes: ArrayBuffer; type: string }> {
  if (!(photo instanceof Blob)) return photo;
  try {
    return { bytes: await photo.arrayBuffer(), type: photo.type || "image/jpeg" };
  } catch {
    throw new PhotoReadError();
  }
}

export async function outboxItemFromDraft(draft: Draft, userId: string): Promise<OutboxItem> {
  const photos = {} as Record<PhotoKey, StoredPhoto>;
  for (const [key, blob] of Object.entries(draft.photos) as [PhotoKey, Blob][]) {
    photos[key] = await photoBytes(blob);
  }
  return {
    id: crypto.randomUUID(),
    userId,
    deliveredAt: Date.now(),
    clientId: draft.clientId,
    clientName: draft.clientName,
    invoiceNumber: draft.invoiceNumber,
    photos,
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
