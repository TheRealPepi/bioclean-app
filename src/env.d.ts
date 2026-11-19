/// <reference types="google.maps" />

// The frontend typechecks Convex modules through the generated `api` types.
// Those read `process.env` (Convex env vars), so declare it without pulling in
// all of @types/node.
declare const process: { env: Record<string, string | undefined> };

interface ImportMetaEnv {
  /** Browser key for the route builder's map and address search. Optional: see "Rutas" in the README. */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
  readonly VITE_GOOGLE_MAPS_MAP_ID?: string;
}
