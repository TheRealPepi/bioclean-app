import { expect, test } from "vitest";
import { optimizeStops, routeLengthMeters } from "./routeOrder";

type Stop = { id: number; location: { lat: number; lng: number } };

const base = { lat: 20.5, lng: -86.95 };

/** The same "random" stops around Cozumel on every run. */
function scattered(count: number): Stop[] {
  let seed = 7;
  const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, (_, id) => ({
    id,
    location: { lat: 20.4 + next() * 0.2, lng: -87 + next() * 0.2 },
  }));
}

const length = (from: typeof base | null, stops: Stop[], returnToBase: boolean) =>
  routeLengthMeters(from, stops.map((s) => s.location), returnToBase);

test("stops along a line are visited from the nearest to the farthest", () => {
  const at = (id: number): Stop => ({ id, location: { lat: base.lat + id * 0.01, lng: base.lng } });
  const ordered = optimizeStops(base, [at(3), at(1), at(4), at(2)], false);
  expect(ordered.map((s) => s.id)).toEqual([1, 2, 3, 4]);
});

// 6 stops tries every order; 14 uses the approximate method for long routes.
test.each([6, 14])("ordering %i stops keeps every stop and never makes the route longer", (count) => {
  const given = scattered(count);
  for (const from of [base, null]) {
    for (const returnToBase of [true, false]) {
      const ordered = optimizeStops(from, given, returnToBase);
      expect(ordered.map((s) => s.id).sort((a, b) => a - b)).toEqual(given.map((s) => s.id));
      expect(length(from, ordered, returnToBase)).toBeLessThanOrEqual(
        length(from, given, returnToBase) + 1e-6,
      );
    }
  }
});
