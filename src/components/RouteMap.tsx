import { useEffect, useRef, useState } from "react";
import {
  googleMapsKey,
  googleMapsMapId,
  loadGoogleMaps,
  onGoogleMapsKeyRejected,
} from "../lib/googleMaps";
import styles from "./RouteMap.module.css";
import { Spinner } from "./Spinner";

type Point = { lat: number; lng: number };
export type MapClient = { id: string; name: string; location: Point };

// Shown until there's something to frame: the company's service area if it
// has one, or else the whole country.
const COUNTRY = { center: { lat: 23.6, lng: -102.5 }, zoom: 5 };
const AREA_ZOOM = 13;
// Close enough to tell one building from the next.
const STREET_ZOOM = 18;
const MAX_FRAMED_ZOOM = 16;

type Status = "loading" | "ready" | "no-key" | "unreachable" | "key-rejected";

const PROBLEMS: Record<Exclude<Status, "loading" | "ready">, string> = {
  "no-key":
    "Falta configurar la llave de Google Maps (VITE_GOOGLE_MAPS_API_KEY). Mientras tanto puedes armar la ruta con la lista de clientes.",
  unreachable: "No se pudo cargar Google Maps. Revisa tu conexión y recarga la página.",
  "key-rejected":
    "Google Maps rechazó la llave. Revisa en Google Cloud que esté activa, que tenga habilitadas Maps JavaScript API y Places API (New), y que permita esta dirección web.",
};

/** A round badge centred on its point (Google anchors markers by their bottom edge by default). */
function badge(text: string, className: string): HTMLElement {
  const element = document.createElement("div");
  element.className = className;
  element.textContent = text;
  return element;
}
const CENTRED = { anchorLeft: "-50%", anchorTop: "-50%" };

/**
 * For taking things off the map. When Google rejects the key it tears the map
 * down, and detaching a marker from it then throws; an error in an effect's
 * cleanup would blank the whole page.
 */
function quietly(detach: () => void) {
  try {
    detach();
  } catch {
    // The map is already gone.
  }
}

/**
 * Route preview on Google Maps: numbered pins for the stops in visit order
 * joined by straight lines, the base, and a dot for every other client so the
 * office sees who else is nearby.
 */
export function RouteMap({
  defaultCenter,
  base,
  stops,
  others,
  returnToBase,
  picking,
  focus,
  draft,
  draftLabel = "B",
  onToggle,
  onPick,
}: {
  /** The centre of the company's service area. Only read when the map is created. */
  defaultCenter?: Point | null;
  base: Point | null;
  stops: MapClient[];
  others: MapClient[];
  returnToBase: boolean;
  /** A click on the map picks a point (the base, or a stop's location for this route). */
  picking: boolean;
  /** Zooms in on this point each time it changes (a place found by address). */
  focus?: Point | null;
  /** Where the base or the stop would go: a pin the office can drag before confirming. */
  draft?: Point | null;
  /** What the draft pin says: "B" for the base, the stop's number for a stop. */
  draftLabel?: string;
  onToggle: (id: string) => void;
  /** A point chosen by clicking the map or by dragging the draft pin. */
  onPick: (point: Point) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<google.maps.Map | null>(null);
  const [status, setStatus] = useState<Status>(googleMapsKey ? "loading" : "no-key");
  // Latest props for the map's handlers, which are attached only once.
  const handlers = useRef({ picking, onToggle, onPick });
  handlers.current = { picking, onToggle, onPick };

  useEffect(() => {
    if (!googleMapsKey) return;
    let unmounted = false;
    let rejected = false;
    const stopListening = onGoogleMapsKeyRejected(() => {
      // Google blanks the map then; drawing on it would only throw.
      rejected = true;
      setStatus("key-rejected");
      setMap(null);
    });
    loadGoogleMaps()
      .then(() => Promise.all([google.maps.importLibrary("maps"), google.maps.importLibrary("marker")]))
      .then(() => {
        if (unmounted || rejected || !container.current) return;
        const instance = new google.maps.Map(container.current, {
          center: defaultCenter ?? COUNTRY.center,
          zoom: defaultCenter ? AREA_ZOOM : COUNTRY.zoom,
          mapId: googleMapsMapId,
          // Scroll zooms the map, as the page itself rarely needs scrolling here.
          gestureHandling: "greedy",
          zoomControl: true,
          streetViewControl: false,
          fullscreenControl: false,
          // Satellite view helps to find the warehouse.
          mapTypeControl: true,
          // Businesses on the map don't open Google's own info window.
          clickableIcons: false,
        });
        instance.addListener("click", (event: google.maps.MapMouseEvent) => {
          if (handlers.current.picking && event.latLng) {
            handlers.current.onPick({ lat: event.latLng.lat(), lng: event.latLng.lng() });
          }
        });
        setMap(instance);
        setStatus("ready");
      })
      .catch(() => {
        if (!unmounted) setStatus("unreachable");
      });
    return () => {
      unmounted = true;
      stopListening();
    };
  }, []);

  useEffect(() => {
    if (!map) return;
    const { AdvancedMarkerElement } = google.maps.marker;
    const toggle = (id: string) => () => {
      if (!handlers.current.picking) handlers.current.onToggle(id);
    };
    const markers: google.maps.marker.AdvancedMarkerElement[] = [];

    for (const client of others) {
      const marker = new AdvancedMarkerElement({
        map,
        position: client.location,
        content: badge("", styles.dot),
        title: client.name,
        gmpClickable: true,
        ...CENTRED,
      });
      marker.addEventListener("gmp-click", toggle(client.id));
      markers.push(marker);
    }

    const path = [
      ...(base ? [base] : []),
      ...stops.map((s) => s.location),
      ...(base && returnToBase && stops.length > 0 ? [base] : []),
    ];
    const line =
      path.length > 1
        ? new google.maps.Polyline({
            map,
            path,
            strokeColor: "#136b58",
            strokeWeight: 3,
            strokeOpacity: 0.8,
            clickable: false,
          })
        : null;

    if (base) {
      markers.push(
        new AdvancedMarkerElement({
          map,
          position: base,
          content: badge("B", `${styles.pin} ${styles.base}`),
          title: "Base",
          zIndex: 500,
          ...CENTRED,
        }),
      );
    }

    stops.forEach((stop, i) => {
      const marker = new AdvancedMarkerElement({
        map,
        position: stop.location,
        content: badge(String(i + 1), styles.pin),
        title: `${i + 1}. ${stop.name}`,
        gmpClickable: true,
        zIndex: 1000,
        ...CENTRED,
      });
      marker.addEventListener("gmp-click", toggle(stop.id));
      markers.push(marker);
    });

    return () =>
      quietly(() => {
        for (const marker of markers) marker.map = null;
        line?.setMap(null);
      });
  }, [map, base, stops, others, returnToBase]);

  // The proposed point, apart from the rest so dragging it doesn't redraw every pin.
  useEffect(() => {
    if (!map || !draft) return;
    const marker = new google.maps.marker.AdvancedMarkerElement({
      map,
      position: draft,
      content: badge(draftLabel, `${styles.pin} ${styles.draft}`),
      title: "Arrastra el pin al punto exacto",
      gmpDraggable: true,
      zIndex: 2000,
      ...CENTRED,
    });
    marker.addEventListener("gmp-dragend", () => {
      const position = marker.position;
      if (!position) return;
      // A LatLng has methods; the literal Google sets after a drag has numbers.
      const read = (value: number | (() => number)) => (typeof value === "function" ? value() : value);
      handlers.current.onPick({ lat: read(position.lat), lng: read(position.lng) });
    });
    return () =>
      quietly(() => {
        marker.map = null;
      });
  }, [map, draft, draftLabel]);

  // Reframes only when the set of points changes (not on a reorder), so it
  // doesn't fight the office panning around.
  const stopIds = stops
    .map((s) => s.id)
    .sort()
    .join(",");
  const baseKey = base ? `${base.lat},${base.lng}` : "";
  const hasClients = stops.length + others.length > 0;
  useEffect(() => {
    // While picking, the office is looking at one spot: don't zoom away from it.
    if (!map || handlers.current.picking) return;
    const framed = stops.length > 0 ? stops : others;
    const points = [...framed.map((c) => c.location), ...(base ? [base] : [])];
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(MAX_FRAMED_ZOOM);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    for (const point of points) bounds.extend(point);
    map.fitBounds(bounds, 48);
    // Points a few meters apart would otherwise zoom in to the rooftops.
    const settled = google.maps.event.addListenerOnce(map, "idle", () => {
      if ((map.getZoom() ?? 0) > MAX_FRAMED_ZOOM) map.setZoom(MAX_FRAMED_ZOOM);
    });
    return () => quietly(() => settled.remove());
  }, [map, stopIds, baseKey, hasClients]);

  useEffect(() => {
    if (!map || !focus) return;
    map.setCenter(focus);
    map.setZoom(STREET_ZOOM);
  }, [map, focus]);

  useEffect(() => {
    map?.setOptions({ draggableCursor: picking ? "crosshair" : null });
  }, [map, picking]);

  const problem = status === "loading" || status === "ready" ? null : PROBLEMS[status];
  return (
    <div className={styles.frame}>
      {/* Google fills this element with its own markup, so React never changes it. */}
      {status !== "no-key" && (
        <div ref={container} className={styles.map} role="application" aria-label="Mapa de la ruta" />
      )}
      {status === "loading" && (
        <div className={styles.cover}>
          <Spinner />
        </div>
      )}
      {problem && (
        <div className={styles.cover} role="status">
          <p>{problem}</p>
        </div>
      )}
    </div>
  );
}
