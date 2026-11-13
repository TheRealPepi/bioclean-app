// Shared by the backend and the frontend (location step).

export type Point = { lat: number; lng: number };

/** Closer than this, a GPS point counts as the client's saved location. */
export const SAME_PLACE_METERS = 75;

/** Great-circle distance in meters. */
export function distanceMeters(a: Point, b: Point): number {
  const R = 6_371_000;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
