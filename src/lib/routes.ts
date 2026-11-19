import type { FunctionReturnType } from "convex/server";
import type { api } from "../../convex/_generated/api";
import { formatShort } from "./dates";
import { googleMapsRouteUrls, MAPS_STOPS_PER_LINK } from "./maps";

export type AdminRoute = FunctionReturnType<typeof api.routes.listAdmin>[number];
export type DriverRoute = FunctionReturnType<typeof api.routes.listMine>[number];

type Point = { lat: number; lng: number };
type RouteShape = {
  base: Point | null;
  returnToBase: boolean;
  stops: { clientName: string; location: Point }[];
};

/** What the builder starts from: "Usar de nuevo", or the route being edited. */
export type RouteTemplate = {
  driverId: AdminRoute["driverId"];
  /** In visit order. `location` only when the office set one for the route. */
  stops: { clientId: AdminRoute["stops"][number]["clientId"]; location?: Point }[];
  returnToBase: boolean;
};

export const routeTemplate = (route: AdminRoute): RouteTemplate => ({
  driverId: route.driverId,
  stops: route.stops.map((s) => ({
    clientId: s.clientId,
    ...(s.customLocation ? { location: s.location } : {}),
  })),
  returnToBase: route.returnToBase,
});

export const stopsLabel = (n: number) => (n === 1 ? "1 parada" : `${n} paradas`);

/** Google Maps links for the whole route (several when it has many stops). */
export function routeMapsUrls(route: RouteShape): string[] {
  return googleMapsRouteUrls(
    route.stops.map((s) => s.location),
    route.returnToBase ? route.base : null,
  );
}

/** "Paradas 1 a 10", for a route split in several links. */
export function legLabel(index: number, route: RouteShape): string {
  const first = index * MAPS_STOPS_PER_LINK + 1;
  if (first > route.stops.length) return "Regreso a la base";
  const last = Math.min(first + MAPS_STOPS_PER_LINK - 1, route.stops.length);
  return first === last ? `Parada ${first}` : `Paradas ${first} a ${last}`;
}

/** The text the office sends the driver by WhatsApp. */
export function routeMessage(
  route: RouteShape & { driverName: string; expiresAt: number },
  appUrl: string,
): string {
  const urls = routeMapsUrls(route);
  const lines = [
    `Ruta de entregas · ${route.driverName.split(" ")[0]}`,
    `${stopsLabel(route.stops.length)}${route.returnToBase && route.base ? " y regreso a la base" : ""}`,
    "",
    ...route.stops.map((stop, i) => `${i + 1}. ${stop.clientName}`),
    "",
  ];
  if (urls.length === 1) {
    lines.push("Abrir en Google Maps:", urls[0]);
  } else {
    lines.push("Abrir en Google Maps (un enlace por tramo):");
    urls.forEach((url, i) => lines.push(`${legLabel(i, route)}: ${url}`));
  }
  lines.push(
    "",
    `También la tienes en la app, en "Tu ruta", hasta el ${formatShort(route.expiresAt)}:`,
    appUrl,
  );
  return lines.join("\n");
}
