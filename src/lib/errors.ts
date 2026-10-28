import { ConvexError } from "convex/values";

/** User-facing message for an error thrown by a Convex function or the network. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === "string") return error.data;
  if (!navigator.onLine) return "Sin conexión a internet. Revisa tu señal e inténtalo de nuevo.";
  return "Algo salió mal. Inténtalo de nuevo.";
}
