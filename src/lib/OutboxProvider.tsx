import { useConvexAuth, useMutation } from "convex/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { Draft, PhotoKey } from "./draft";
import { errorMessage } from "./errors";
import type { Me } from "./me";
import {
  addToOutbox,
  itemInvoices,
  listOutbox,
  outboxItemFromDraft,
  photoBytes,
  PhotoReadError,
  removeFromOutbox,
  updateOutboxItem,
  type OutboxItem,
  type StoredPhoto,
} from "./outbox";
import { useOnline } from "./useOnline";

const PHOTO_KEYS: PhotoKey[] = ["receiver", "goods"];
// A photo is a few hundred KB; on a weak signal give up after a minute and retry later.
const UPLOAD_TIMEOUT_MS = 60_000;
const RETRY_INTERVAL_MS = 30_000;

type Outbox = {
  /** Deliveries saved on this phone and not uploaded yet, oldest first. */
  items: OutboxItem[];
  /** The item being uploaded right now. */
  uploadingId: string | null;
  /** Saves a finished delivery on the phone and starts uploading it if there's signal. */
  enqueue: (draft: Draft) => Promise<void>;
  /** Uploads now, including items that failed before. */
  syncNow: () => void;
};

const OutboxContext = createContext<Outbox | null>(null);

/** The driver's outbox; null for admins. */
export function useOutbox(): Outbox | null {
  return useContext(OutboxContext);
}

/**
 * The photo upload request failed (no signal, timeout). Convex mutations never
 * fail for lack of signal (they wait and retry by themselves), so this is the
 * only error that means "try again later"; any other one is a server rejection.
 */
class UploadNetworkError extends Error {}

/** Only one tab uploads at a time (locks are missing on old browsers; then it's per tab). */
async function withSyncLock(fn: () => Promise<void>): Promise<void> {
  if (navigator.locks) await navigator.locks.request("bioclean-sync", fn);
  else await fn();
}

export function OutboxProvider({ me, children }: { me: Me; children: ReactNode }) {
  const online = useOnline();
  const { isAuthenticated } = useConvexAuth();
  const generateUploadUrl = useMutation(api.deliveries.generateUploadUrl);
  const createDelivery = useMutation(api.deliveries.create);

  const [items, setItems] = useState<OutboxItem[]>([]);
  const [uploadingId, setUploadingId] = useState<string | null>(null);

  const canSync = online && isAuthenticated;
  const canSyncRef = useRef(canSync);
  useEffect(() => {
    canSyncRef.current = canSync;
  }, [canSync]);

  const refresh = useCallback(async () => {
    try {
      setItems(await listOutbox(me._id));
    } catch {
      // Storage unavailable: nothing can be waiting in it either.
    }
  }, [me._id]);

  useEffect(() => {
    void refresh();
    // Ask the browser not to clear this site's storage when the phone is low
    // on space (granted to installed apps on Android; iPhone keeps the data of
    // home-screen apps anyway).
    void navigator.storage?.persist?.().catch(() => {});
  }, [refresh]);

  const uploadPhoto = useCallback(
    async (photo: StoredPhoto): Promise<Id<"_storage">> => {
      // Read before the request, so an unreadable photo isn't mistaken for no signal.
      const { bytes, type } = await photoBytes(photo);
      const url = await generateUploadUrl();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      const networkError = (e: unknown) => {
        throw new UploadNetworkError(String(e));
      };
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": type },
          body: bytes,
          signal: controller.signal,
        }).catch(networkError);
        // A 5xx is a server hiccup worth retrying; a 4xx will fail every time.
        if (response.status >= 500) throw new UploadNetworkError(`Upload failed: ${response.status}`);
        if (!response.ok) throw new Error(`Upload failed: ${response.status}`);
        const { storageId } = (await response.json().catch(networkError)) as {
          storageId: Id<"_storage">;
        };
        return storageId;
      } finally {
        clearTimeout(timer);
      }
    },
    [generateUploadUrl],
  );

  const uploadItem = useCallback(
    async (item: OutboxItem) => {
      // Converted to the new shape on the first upload of an older item.
      const invoices = itemInvoices(item).map((i) => ({ ...i }));
      for (const invoice of invoices) {
        if (invoice.photoId) continue;
        invoice.photoId = await uploadPhoto(invoice.photo);
        await updateOutboxItem(item.id, { invoices });
      }
      const photoIds = { ...item.photoIds };
      for (const key of PHOTO_KEYS) {
        if (photoIds[key]) continue;
        photoIds[key] = await uploadPhoto(item.photos[key]);
        await updateOutboxItem(item.id, { photoIds });
      }
      await createDelivery({
        clientId: item.clientId,
        clientName: item.clientName,
        invoices: invoices.map((i) => ({ number: i.number, photoId: i.photoId! })),
        receiverPhotoId: photoIds.receiver!,
        goodsPhotoId: photoIds.goods!,
        location: item.location,
        locationSource: item.locationSource,
        driverPosition: item.driverPosition,
        vehicleId: item.vehicleId,
        payment: item.payment,
        status: item.status,
        notes: item.notes,
        deliveredAt: item.deliveredAt,
        clientRequestId: item.id,
      });
    },
    [uploadPhoto, createDelivery],
  );

  const running = useRef(false);
  const runAgain = useRef(false);

  const sync = useCallback(async () => {
    if (running.current) {
      runAgain.current = true;
      return;
    }
    running.current = true;
    try {
      await withSyncLock(async () => {
        // Read inside the lock: another tab may have just uploaded some.
        for (const item of await listOutbox(me._id)) {
          if (!canSyncRef.current) break;
          if (item.error) continue;
          setUploadingId(item.id);
          try {
            await uploadItem(item);
            await removeFromOutbox(item.id);
          } catch (e) {
            if (e instanceof UploadNetworkError) break; // No signal: try again later.
            // Rejected by the server: keep it on the phone for the driver to
            // retry, uploading the photos again in case they were the problem.
            await updateOutboxItem(item.id, {
              error: e instanceof PhotoReadError ? e.message : errorMessage(e),
              photoIds: {},
              invoices: itemInvoices(item).map(({ photoId: _, ...i }) => i),
            });
          } finally {
            setUploadingId(null);
            await refresh();
          }
        }
      });
    } catch {
      // Storage error; the next trigger tries again.
    } finally {
      running.current = false;
    }
    if (runAgain.current) {
      runAgain.current = false;
      void sync();
    }
  }, [me._id, uploadItem, refresh]);

  // On open and whenever the connection comes back.
  useEffect(() => {
    if (canSync) void sync();
  }, [canSync, sync]);

  // Retry periodically while something is waiting (e.g. an upload timed out).
  const hasPending = items.some((i) => !i.error);
  useEffect(() => {
    if (!canSync || !hasPending) return;
    const timer = setInterval(() => void sync(), RETRY_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canSync, hasPending, sync]);

  // When the driver comes back to the app (phones pause background tabs).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refresh();
      if (canSyncRef.current) void sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh, sync]);

  const enqueue = useCallback(
    async (draft: Draft) => {
      await addToOutbox(await outboxItemFromDraft(draft, me._id));
      await refresh();
      if (canSyncRef.current) void sync();
    },
    [me._id, refresh, sync],
  );

  const syncNow = useCallback(() => {
    void (async () => {
      try {
        for (const item of await listOutbox(me._id)) {
          if (item.error) await updateOutboxItem(item.id, { error: undefined });
        }
      } catch {
        // ignore
      }
      await refresh();
      void sync();
    })();
  }, [me._id, refresh, sync]);

  const value = useMemo(
    () => ({ items, uploadingId, enqueue, syncNow }),
    [items, uploadingId, enqueue, syncNow],
  );
  return <OutboxContext.Provider value={value}>{children}</OutboxContext.Provider>;
}
