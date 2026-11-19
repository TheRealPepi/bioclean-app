// Loads the Google Maps JavaScript API on demand (only the office's route
// builder uses it). The key is a browser key: anyone can read it, so it must be
// restricted in Google Cloud to this app's addresses and to the two APIs used
// (Maps JavaScript API and Places API). See "Rutas" in the README.

const env = (value: string | undefined) => value?.trim() || null;

/** Null until `VITE_GOOGLE_MAPS_API_KEY` is set: the builder then works without a map. */
export const googleMapsKey = env(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

// The pins need a map ID. Google's demo one works; your own lets you style the map.
export const googleMapsMapId = env(import.meta.env.VITE_GOOGLE_MAPS_MAP_ID) ?? "DEMO_MAP_ID";

declare global {
  interface Window {
    /** Called by Google when it rejects the key (wrong, disabled, or not allowed on this address). */
    gm_authFailure?: () => void;
    googleMapsReady?: () => void;
  }
}

let loading: Promise<void> | null = null;
let keyRejected = false;
const rejectionListeners = new Set<() => void>();

/** Resolves once `google.maps.importLibrary` can be used. Rejects without a key or without connection. */
export function loadGoogleMaps(): Promise<void> {
  const key = googleMapsKey;
  if (!key) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not set"));
  loading ??= new Promise<void>((resolve, reject) => {
    window.gm_authFailure = () => {
      keyRejected = true;
      rejectionListeners.forEach((listener) => listener());
    };
    window.googleMapsReady = () => resolve();
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      callback: "googleMapsReady",
      language: "es",
      region: "MX",
    });
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      // Let a later attempt (e.g. once the connection is back) try again.
      loading = null;
      script.remove();
      reject(new Error("The Google Maps script could not be loaded"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * Google only says a key is rejected after the map has started loading, so
 * this can fire a moment after `loadGoogleMaps` resolved. Returns the unsubscribe.
 */
export function onGoogleMapsKeyRejected(listener: () => void): () => void {
  if (keyRejected) listener();
  rejectionListeners.add(listener);
  return () => rejectionListeners.delete(listener);
}
