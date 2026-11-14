// Shared by the backend (payment reminders) and the frontend.

// Cozumel uses America/Cancun: UTC-5 all year (no daylight saving since 2015),
// so day boundaries are computed with a fixed offset.
const OFFSET_MS = 5 * 60 * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS_LONG = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** Wall-clock parts in Cozumel time. */
export function localParts(ms: number) {
  const d = new Date(ms - OFFSET_MS);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the given instant in Cozumel (value for <input type="date">). */
export function isoDate(ms: number = Date.now()): string {
  const { year, month, day } = localParts(ms);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

/** Start of the given "YYYY-MM-DD" day in Cozumel, as a timestamp. */
export function startOfDay(iso: string): number {
  return Date.parse(`${iso}T00:00:00-05:00`);
}

export function shiftDays(iso: string, days: number): string {
  return isoDate(startOfDay(iso) + days * DAY_MS);
}

/** Whole days from one "YYYY-MM-DD" to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / DAY_MS);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(startOfDay(value));
}

/** "23 de octubre de 2026" for a "YYYY-MM-DD" day. */
export function formatIsoLong(iso: string): string {
  const { day, month, year } = localParts(startOfDay(iso));
  return `${day} de ${MONTHS_LONG[month]} de ${year}`;
}
