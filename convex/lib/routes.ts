// Shared by the backend and the frontend (route builder).

const HOUR_MS = 60 * 60 * 1000;

/** How long a driver sees a route, counted from when the office created it. */
export const ROUTE_TTL_MS = 24 * HOUR_MS;

/** How long an expired route stays in the office's list before it's deleted. */
export const ROUTE_KEEP_MS = 30 * 24 * HOUR_MS;

export const MAX_ROUTE_STOPS = 25;
