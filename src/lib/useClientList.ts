import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState } from "react";
import { api } from "../../convex/_generated/api";
import { readCache, writeCache } from "./offlineCache";

export type ClientList = FunctionReturnType<typeof api.clients.list>;
export type ClientListState = {
  /** Live list, or the last one saved on this phone; undefined if never downloaded. */
  clients: ClientList | undefined;
  /** When the saved list was last refreshed from the server. */
  syncedAt: number | undefined;
};

const KEY = "clients";
const SYNCED_KEY = "clientsSyncedAt";

/**
 * Subscribes to the client list for as long as the driver app is open, so it's
 * downloaded to the phone as soon as there's signal (not only when the driver
 * happens to open "Nueva entrega") and is available later without signal.
 */
export function useClientList(): ClientListState {
  const live = useQuery(api.clients.list, {});
  const [cached] = useState(() => readCache<ClientList>(KEY));
  const [syncedAt, setSyncedAt] = useState(() => readCache<number>(SYNCED_KEY));

  useEffect(() => {
    if (live === undefined) return;
    const now = Date.now();
    writeCache(KEY, live);
    writeCache(SYNCED_KEY, now);
    setSyncedAt(now);
  }, [live]);

  return { clients: live ?? cached, syncedAt };
}
