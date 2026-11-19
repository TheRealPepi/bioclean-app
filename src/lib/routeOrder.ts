import { distanceMeters, type Point } from "../../convex/lib/geo";

/** Straight-line length of base → stops in order (→ base), in meters. */
export function routeLengthMeters(
  base: Point | null,
  stops: Point[],
  returnToBase: boolean,
): number {
  const path = [...(base ? [base] : []), ...stops, ...(base && returnToBase ? [base] : [])];
  let total = 0;
  for (let i = 1; i < path.length; i++) total += distanceMeters(path[i - 1], path[i]);
  return total;
}

/** Up to this many stops, every possible order is tried. */
const EXACT_MAX_STOPS = 9;

/**
 * Puts the stops in a short visiting order, starting at the base (and ending
 * there with `returnToBase`). Without a base, the route may start at any stop.
 *
 * Distances are straight lines, not streets: good enough to avoid crossing the
 * town back and forth, and the office can still reorder by hand.
 *
 * Short routes get the shortest order there is. Longer ones start from "always
 * go to the nearest stop" (and from the order given) and keep reversing
 * stretches (2-opt) and moving single stops while that makes the route
 * shorter, so the result is never longer than the order given.
 */
export function optimizeStops<T extends { location: Point }>(
  base: Point | null,
  stops: T[],
  returnToBase: boolean,
): T[] {
  const n = stops.length;
  if (n < 2) return [...stops];

  // Nodes 0..n-1 are the stops; node n is the base, when there is one.
  const points = stops.map((s) => s.location);
  if (base) points.push(base);
  const dist = points.map((a) => points.map((b) => distanceMeters(a, b)));
  const closed = base !== null && returnToBase;

  const length = (order: number[]) => {
    let total = 0;
    let prev = base ? n : -1;
    for (const i of order) {
      if (prev >= 0) total += dist[prev][i];
      prev = i;
    }
    return closed ? total + dist[prev][n] : total;
  };

  const shortest = (): number[] => {
    let best: number[] = [];
    let bestLength = Infinity;
    const order: number[] = [];
    const used = stops.map(() => false);
    const visit = (prev: number, total: number) => {
      if (total >= bestLength) return;
      if (order.length === n) {
        const full = closed ? total + dist[prev][n] : total;
        if (full < bestLength) {
          best = [...order];
          bestLength = full;
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true;
        order.push(i);
        visit(i, prev < 0 ? total : total + dist[prev][i]);
        order.pop();
        used[i] = false;
      }
    };
    visit(base ? n : -1, 0);
    return best;
  };
  if (n <= EXACT_MAX_STOPS) return shortest().map((i) => stops[i]);

  const nearestFirst = (from: number): number[] => {
    const left = new Set(stops.map((_, i) => i));
    left.delete(from);
    const order = from < n ? [from] : [];
    let at = from;
    while (left.size > 0) {
      let next = -1;
      for (const i of left) if (next < 0 || dist[at][i] < dist[at][next]) next = i;
      left.delete(next);
      order.push(next);
      at = next;
    }
    return order;
  };

  const improve = (start: number[]): number[] => {
    let order = start;
    let best = length(order);
    for (let improved = true; improved; ) {
      improved = false;
      const accept = (candidate: number[]) => {
        const candidateLength = length(candidate);
        if (candidateLength < best - 1e-6) {
          order = candidate;
          best = candidateLength;
          improved = true;
        }
      };
      for (let i = 0; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          accept([...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)]);
        }
      }
      for (let from = 0; from < n; from++) {
        for (let to = 0; to < n; to++) {
          if (from === to) continue;
          const moved = order.filter((_, i) => i !== from);
          moved.splice(to, 0, order[from]);
          accept(moved);
        }
      }
    }
    return order;
  };

  const starts = base ? [n] : stops.map((_, i) => i);
  let best = improve(stops.map((_, i) => i));
  for (const start of starts) {
    const order = improve(nearestFirst(start));
    if (length(order) < length(best)) best = order;
  }
  return best.map((i) => stops[i]);
}
