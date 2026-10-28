// Cozumel uses America/Cancun: UTC-5 all year (no daylight saving since 2015),
// so day boundaries are computed with a fixed offset.
const OFFSET_MS = 5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "America/Cancun";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** Wall-clock parts in Cozumel time. */
function local(ms: number) {
  const d = new Date(ms - OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the given instant in Cozumel (value for <input type="date">). */
export function isoDate(ms: number = Date.now()): string {
  const { year, month, day } = local(ms);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Start of the given "YYYY-MM-DD" day in Cozumel, as a timestamp. */
export function startOfDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00-05:00`);
}

export function shiftDays(iso: string, days: number): string {
  return isoDate(startOfDay(iso) + days * DAY_MS);
}

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
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ms);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
