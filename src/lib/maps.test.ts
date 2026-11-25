import { expect, test } from "vitest";
import { googleMapsRouteUrls } from "./maps";
import { routeMapsUrls } from "./routes";

type Point = { lat: number; lng: number };

/** Stops about 1 km apart, going north. */
const stop = (i: number): Point => ({ lat: 20.5 + i * 0.01, lng: -86.95 });
const stops = (n: number) => Array.from({ length: n }, (_, i) => stop(i));
const text = ({ lat, lng }: Point) => `${lat},${lng}`;

/** What a link asks Google Maps for. */
function parse(url: string) {
  const params = new URL(url).searchParams;
  return {
    origin: params.get("origin"),
    waypoints: params.get("waypoints")?.split("|") ?? [],
    destination: params.get("destination"),
  };
}

test("a single stop is the destination, with nothing in between", () => {
  const [url, ...rest] = googleMapsRouteUrls([stop(0)]);
  expect(rest).toEqual([]);
  expect(parse(url)).toEqual({ origin: null, waypoints: [], destination: text(stop(0)) });
});

test("stops are visited in order, starting from wherever the phone is", () => {
  const [url] = googleMapsRouteUrls(stops(3));
  expect(parse(url)).toEqual({
    origin: null,
    waypoints: [text(stop(0)), text(stop(1))],
    destination: text(stop(2)),
  });
});

test("a route with more than 10 stops is split into several links", () => {
  const urls = googleMapsRouteUrls(stops(11));
  expect(urls).toHaveLength(2);
  expect(parse(urls[0]).waypoints).toHaveLength(9);
  expect(parse(urls[0]).destination).toBe(text(stop(9)));
  expect(parse(urls[1])).toMatchObject({ waypoints: [], destination: text(stop(10)) });
});

test("the route ends at the given end point", () => {
  const base = { lat: 20.4, lng: -86.9 };
  const [url] = googleMapsRouteUrls(stops(2), base);
  expect(parse(url)).toMatchObject({
    waypoints: [text(stop(0)), text(stop(1))],
    destination: text(base),
  });
});

// Google Maps can't route between two stops at the same spot (commit 5bb4e46).
test("two consecutive stops at the same spot go into the link as one", () => {
  const nextDoor = { lat: stop(0).lat + 0.00001, lng: stop(0).lng };
  const [url] = googleMapsRouteUrls([stop(0), nextDoor, stop(1)]);
  expect(parse(url)).toMatchObject({ waypoints: [text(stop(0))], destination: text(stop(1)) });
});

test("merging stops at the same spot doesn't change how the route is split", () => {
  const eleven = stops(11);
  eleven[1] = { ...eleven[0] };
  const urls = googleMapsRouteUrls(eleven);
  expect(urls).toHaveLength(2);
  expect(parse(urls[0]).destination).toBe(text(stop(9)));
});

test("a route goes back to the base only when the office asked for it", () => {
  const base = { lat: 20.4, lng: -86.9 };
  const route = {
    base,
    stops: stops(2).map((location, i) => ({ clientName: `Cliente ${i}`, location })),
  };
  expect(parse(routeMapsUrls({ ...route, returnToBase: true })[0]).destination).toBe(text(base));
  expect(parse(routeMapsUrls({ ...route, returnToBase: false })[0]).destination).toBe(text(stop(1)));
});
