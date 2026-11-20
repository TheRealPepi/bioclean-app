import { distanceMeters } from "../../convex/lib/geo";

type Point = { lat: number; lng: number };

const coords = ({ lat, lng }: Point) => `${lat},${lng}`;

export function googleMapsUrl(point: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${coords(point)}`;
}

/** Driving directions from wherever the phone is to `point`. */
export function googleMapsNavUrl(point: Point): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords(point)}&travelmode=driving`;
}

/** A Google Maps link takes 9 intermediate stops plus the destination. */
export const MAPS_STOPS_PER_LINK = 10;

/**
 * Consecutive stops this close go into the link as one. Google Maps can't route
 * a leg between two stops at the same spot: the app opens on a "choose a place"
 * screen with no Start button.
 */
const SAME_STOP_METERS = 10;

/**
 * Driving directions through `stops` in order, ending at `end` if given. One
 * link per `MAPS_STOPS_PER_LINK` stops, because Google ignores the rest.
 *
 * Stops are split into links before the ones at the same spot are merged, so
 * the number of links and which stops each one covers don't depend on that.
 *
 * No origin on purpose: Google then starts from where the phone is, which is
 * the only way it offers turn-by-turn navigation instead of a preview.
 */
export function googleMapsRouteUrls(stops: Point[], end?: Point | null): string[] {
  const points = end ? [...stops, end] : stops;
  const urls: string[] = [];
  for (let i = 0; i < points.length; i += MAPS_STOPS_PER_LINK) {
    const leg: Point[] = [];
    for (const point of points.slice(i, i + MAPS_STOPS_PER_LINK)) {
      const previous = leg[leg.length - 1];
      if (!previous || distanceMeters(previous, point) > SAME_STOP_METERS) leg.push(point);
    }
    const params = new URLSearchParams({
      api: "1",
      destination: coords(leg[leg.length - 1]),
      travelmode: "driving",
    });
    if (leg.length > 1) params.set("waypoints", leg.slice(0, -1).map(coords).join("|"));
    urls.push(`https://www.google.com/maps/dir/?${params.toString()}`);
  }
  return urls;
}

/** OpenStreetMap embed (no API key needed). */
export function osmEmbedUrl({ lat, lng }: Point): string {
  const dLng = 0.004;
  const dLat = 0.0025;
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
