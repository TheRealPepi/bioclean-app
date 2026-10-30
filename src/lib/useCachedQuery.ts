import { useQuery } from "convex/react";
import type { FunctionReference, FunctionReturnType } from "convex/server";
import { useEffect, useMemo } from "react";
import { readCache, writeCache } from "./offlineCache";

/**
 * `useQuery` that remembers its last result under `cacheKey` and returns it
 * while the live result isn't available (no signal, or still connecting).
 */
export function useCachedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: Query["_args"],
  cacheKey: string,
): FunctionReturnType<Query> | undefined {
  const live = useQuery(query, args);
  const cached = useMemo(() => readCache<FunctionReturnType<Query>>(cacheKey), [cacheKey]);
  useEffect(() => {
    if (live !== undefined) writeCache(cacheKey, live);
  }, [live, cacheKey]);
  return live ?? cached;
}
