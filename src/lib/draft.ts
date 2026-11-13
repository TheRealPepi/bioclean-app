import { del, get, set } from "idb-keyval";
import type { Id } from "../../convex/_generated/dataModel";
import type { LocationSource, Payment } from "./payment";
import type { DeliveryStatus } from "./status";

export type PhotoKey = "receiver" | "goods";
export type LatLng = { lat: number; lng: number; accuracy?: number };
export type DraftInvoice = { number: string; photo?: Blob };

export type Draft = {
  version: 2;
  step: number;
  clientId?: Id<"clients">;
  clientName: string;
  vehicleId?: Id<"vehicles">;
  vehicleName?: string;
  invoices: DraftInvoice[];
  photos: Partial<Record<PhotoKey, Blob>>;
  location?: LatLng;
  locationSource?: LocationSource;
  /** Background GPS position when the driver confirmed the client's saved location. */
  driverPosition?: LatLng;
  status?: DeliveryStatus;
  payment?: Payment;
  notes: string;
  updatedAt: number;
};

export const emptyDraft = (vehicle?: { _id: Id<"vehicles">; name: string }): Draft => ({
  version: 2,
  step: 0,
  clientName: "",
  vehicleId: vehicle?._id,
  vehicleName: vehicle?.name,
  invoices: [{ number: "" }],
  photos: {},
  notes: "",
  updatedAt: Date.now(),
});

/** A draft saved by the app before several facturas were allowed. */
type DraftV1 = Omit<Draft, "version" | "invoices" | "photos"> & {
  version?: undefined;
  invoiceNumber: string;
  photos: Partial<Record<"invoice" | PhotoKey, Blob>>;
};

function upgrade(saved: Draft | DraftV1): Draft {
  if (saved.version === 2) return saved;
  const { invoiceNumber, photos, ...rest } = saved;
  return {
    ...rest,
    version: 2,
    // The steps changed, so start again from the first one (nothing is lost).
    step: 0,
    invoices: [{ number: invoiceNumber, photo: photos.invoice }],
    photos: { receiver: photos.receiver, goods: photos.goods },
    // Old drafts captured GPS without comparing with the client's location.
    locationSource: rest.location ? "modificada" : undefined,
  };
}

// Drafts live in IndexedDB (photos included) so a closed tab or lost signal
// doesn't lose the driver's progress. Storage failures (e.g. private mode)
// are ignored: the wizard still works, just without resume.
const key = (userId: string) => `bioclean-draft:${userId}`;

export async function loadDraft(userId: string): Promise<Draft | null> {
  try {
    const saved = await get<Draft | DraftV1>(key(userId));
    return saved ? upgrade(saved) : null;
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

/** The vehicle isn't counted: it's pre-selected from the driver's last delivery. */
export function draftHasContent(draft: Draft): boolean {
  return Boolean(
    draft.clientName ||
      draft.invoices.some((i) => i.number || i.photo) ||
      Object.values(draft.photos).some(Boolean) ||
      draft.location ||
      draft.status ||
      draft.payment ||
      draft.notes,
  );
}
