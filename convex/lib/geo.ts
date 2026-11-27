// Shared by the backend and the frontend (location step).

export type Point = { lat: number; lng: number };

/** Closer than this, a GPS point counts as the client's saved location. */
export const SAME_PLACE_METERS = 75;

export const isValidPoint = (p: Point) =>
  Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

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

/** A box in which every point is at most about `radiusKm` north, south, east or west of `center`. */
export function boundsAround(center: Point, radiusKm: number) {
  const KM_PER_DEGREE = 111.32;
  const dLat = radiusKm / KM_PER_DEGREE;
  const dLng = radiusKm / (KM_PER_DEGREE * Math.max(0.1, Math.cos((center.lat * Math.PI) / 180)));
  return {
    west: Math.max(-180, center.lng - dLng),
    south: Math.max(-90, center.lat - dLat),
    east: Math.min(180, center.lng + dLng),
    north: Math.min(90, center.lat + dLat),
  };
}

/** Width and height of a box, in km (for showing its size). */
export function sizeKm(bounds: { west: number; south: number; east: number; north: number }) {
  const middle = { lat: (bounds.south + bounds.north) / 2, lng: (bounds.west + bounds.east) / 2 };
  return {
    width: distanceMeters({ ...middle, lng: bounds.west }, { ...middle, lng: bounds.east }) / 1000,
    height: distanceMeters({ ...middle, lat: bounds.south }, { ...middle, lat: bounds.north }) / 1000,
  };
}
