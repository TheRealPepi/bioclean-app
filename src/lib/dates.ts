import * as zoned from "../../convex/lib/dates";

export { DAY_MS, daysBetween, formatIsoLong, shiftDays } from "../../convex/lib/dates";

// Every screen shows the company's time, wherever the phone is. See
// convex/lib/dates.ts for the day math.
let timeZone = zoned.LEGACY_TIME_ZONE;

/**
 * Called by `App` as soon as it knows the user's company, before anything that
 * shows a date is rendered.
 */
export function setTimeZone(zone: string) {
  timeZone = zone;
}

const { pad } = zoned;
const local = (ms: number) => zoned.localParts(ms, timeZone);

/** "YYYY-MM-DD" of the given instant (value for <input type="date">). */
export const isoDate = (ms: number = Date.now()) => zoned.isoDate(ms, timeZone);

/** Start of the given "YYYY-MM-DD" day, as a timestamp. */
export const startOfDay = (iso: string) => zoned.startOfDay(iso, timeZone);

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "12:45 p.m." */
export function formatTime(ms: number): string {
  const { hours, minutes } = local(ms);
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${pad(h12)}:${pad(minutes)} ${hours < 12 ? "a.m." : "p.m."}`;
}

/** "23-oct, 12:45 p.m." */
export function formatShort(ms: number): string {
  const { day, month } = local(ms);
  return `${day}-${MONTHS[month]}, ${formatTime(ms)}`;
}

/** "23-oct-2026" */
export function formatDay(ms: number): string {
  const { day, month, year } = local(ms);
  return `${day}-${MONTHS[month]}-${year}`;
}

/** "Jueves, 23 de octubre de 2026" */
export function formatLongDate(ms: number): string {
  const text = new Intl.DateTimeFormat("es-MX", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ms);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
