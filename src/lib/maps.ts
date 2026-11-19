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
 * Driving directions through `stops` in order, ending at `end` if given. One
 * link per `MAPS_STOPS_PER_LINK` stops, because Google ignores the rest.
 *
 * No origin on purpose: Google then starts from where the phone is, which is
 * the only way it offers turn-by-turn navigation instead of a preview.
 */
export function googleMapsRouteUrls(stops: Point[], end?: Point | null): string[] {
  const points = end ? [...stops, end] : stops;
  const urls: string[] = [];
  for (let i = 0; i < points.length; i += MAPS_STOPS_PER_LINK) {
    const leg = points.slice(i, i + MAPS_STOPS_PER_LINK);
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
