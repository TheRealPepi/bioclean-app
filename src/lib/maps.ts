type Point = { lat: number; lng: number };

export function googleMapsUrl({ lat, lng }: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** OpenStreetMap embed (no API key needed). */
export function osmEmbedUrl({ lat, lng }: Point): string {
  const dLng = 0.004;
  const dLat = 0.0025;
  const bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
}
