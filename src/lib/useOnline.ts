import { useConvexConnectionState } from "convex/react";

/**
 * True while connected to the Convex server. More reliable than
 * `navigator.onLine`, which on phones says "online" with a signal too weak to
 * actually reach the server.
 */
export function useOnline(): boolean {
  const { isWebSocketConnected, hasEverConnected, connectionRetries } = useConvexConnectionState();
  if (isWebSocketConnected) return true;
  // Right after opening the app the socket is still connecting; don't flash
  // "sin señal" unless it already failed or the phone knows it's offline.
  if (!hasEverConnected && connectionRetries === 0 && navigator.onLine) return true;
  return false;
}
