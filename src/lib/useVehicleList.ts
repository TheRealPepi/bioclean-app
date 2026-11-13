import type { FunctionReturnType } from "convex/server";
import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { useCachedQuery } from "./useCachedQuery";

export type Vehicle = FunctionReturnType<typeof api.vehicles.list>[number];

/**
 * Active vehicles, subscribed for as long as the driver app is open so the list
 * is saved on the phone (like the client list) and works without signal.
 * Undefined if it was never downloaded.
 */
export function useVehicleList(): Vehicle[] | undefined {
  const all = useCachedQuery(api.vehicles.list, {}, "vehicles");
  return useMemo(() => all?.filter((v) => v.active), [all]);
}
