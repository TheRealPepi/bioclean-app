import { createStore, del, get, set, values, type UseStore } from "idb-keyval";
import type { Id } from "../../convex/_generated/dataModel";
import { cleanInvoice } from "../../convex/lib/text";
import type { Draft, LatLng, PhotoKey } from "./draft";
import type { LocationSource, Payment } from "./payment";
import type { DeliveryStatus } from "./status";

export type OutboxInvoice = {
  number: string;
  photo: StoredPhoto;
  /** Set once uploaded, so a retry only uploads the missing ones. */
  photoId?: Id<"_storage">;
};

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
  vehicleId?: Id<"vehicles">;
  vehicleName?: string;
  /** Missing on items saved before several facturas were allowed (see `itemInvoices`). */
  invoices?: OutboxInvoice[];
  /** Only on those older items. */
  invoiceNumber?: string;
  photos: Record<PhotoKey, StoredPhoto> & { invoice?: StoredPhoto };
  /** Photos already uploaded, so a retry only uploads the missing ones. */
  photoIds: Partial<Record<PhotoKey | "invoice", Id<"_storage">>>;
  location: LatLng;
  locationSource?: LocationSource;
  driverPosition?: LatLng;
  status: DeliveryStatus;
  payment?: Payment;
  notes: string;
  /** Set when the server rejected it; it then waits for the driver to retry. */
  error?: string;
};

/** The item's facturas, also for items saved by older versions with a single one. */
export function itemInvoices(item: OutboxItem): OutboxInvoice[] {
  if (item.invoices) return item.invoices;
  if (item.invoiceNumber === undefined || !item.photos.invoice) return [];
  return [{ number: item.invoiceNumber, photo: item.photos.invoice, photoId: item.photoIds.invoice }];
}

/** Factura numbers for display, e.g. "B-1, B-2". */
export function invoiceLabel(item: OutboxItem): string {
  return itemInvoices(item)
    .map((i) => cleanInvoice(i.number))
    .join(", ");
}

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
  const invoices: OutboxInvoice[] = [];
  for (const invoice of draft.invoices) {
    invoices.push({ number: invoice.number, photo: await photoBytes(invoice.photo!) });
  }
  return {
    id: crypto.randomUUID(),
    userId,
    deliveredAt: Date.now(),
    clientId: draft.clientId,
    clientName: draft.clientName,
    vehicleId: draft.vehicleId,
    vehicleName: draft.vehicleName,
    invoices,
    photos: {
      receiver: await photoBytes(draft.photos.receiver!),
      goods: await photoBytes(draft.photos.goods!),
    },
    photoIds: {},
    location: draft.location!,
    locationSource: draft.locationSource,
    driverPosition: draft.locationSource === "guardada" ? draft.driverPosition : undefined,
    status: draft.status!,
    payment: draft.payment,
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
