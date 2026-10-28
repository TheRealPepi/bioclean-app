// The frontend typechecks Convex modules through the generated `api` types.
// Those read `process.env` (Convex env vars), so declare it without pulling in
// all of @types/node.
declare const process: { env: Record<string, string | undefined> };
