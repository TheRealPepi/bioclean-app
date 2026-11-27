// Shared by the backend (payment reminders) and the frontend.

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The first company's zone (Cozumel). Passed wherever the code doesn't know
 * the company yet.
 */
export const LEGACY_TIME_ZONE = "America/Cancun";

// Zones with the same offset all year don't need the time zone database.
const FIXED_OFFSET_MS = new Map<string, number>([
  // UTC-5 all year (no daylight saving since 2015).
  ["America/Cancun", -5 * 60 * 60 * 1000],
]);

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

const formatters = new Map<string, Intl.DateTimeFormat>();

/**
 * How far the zone's wall clock is from UTC at the given instant (negative in
 * the Americas). Throws a RangeError for a zone that doesn't exist.
 */
export function utcOffsetMs(ms: number, timeZone: string): number {
  const fixed = FIXED_OFFSET_MS.get(timeZone);
  if (fixed !== undefined) return fixed;

  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, formatter);
  }
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(ms)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  const wallClock = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  return wallClock - Math.floor(ms / 1000) * 1000;
}

/** Wall-clock parts of the given instant in the zone. */
export function localParts(ms: number, timeZone: string) {
  const d = new Date(ms + utcOffsetMs(ms, timeZone));
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

export const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the given instant in the zone (value for <input type="date">). */
export function isoDate(ms: number, timeZone: string): string {
  const { year, month, day } = localParts(ms, timeZone);
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

// A "YYYY-MM-DD" day as a number, for calendar math that doesn't depend on any zone.
const calendarMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Start of the given "YYYY-MM-DD" day in the zone, as a timestamp. */
export function startOfDay(iso: string, timeZone: string): number {
  const midnight = calendarMs(iso);
  if (Number.isNaN(midnight)) return NaN;
  // The offset at that instant in UTC is a first guess; the second pass
  // corrects it when the clocks changed in the hours between the two.
  const guess = midnight - utcOffsetMs(midnight, timeZone);
  return midnight - utcOffsetMs(guess, timeZone);
}

export function shiftDays(iso: string, days: number): string {
  const d = new Date(calendarMs(iso) + days * DAY_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Whole days from one "YYYY-MM-DD" to another (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((calendarMs(to) - calendarMs(from)) / DAY_MS);
}

export function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(calendarMs(value));
}

/** "23 de octubre de 2026" for a "YYYY-MM-DD" day. */
export function formatIsoLong(iso: string): string {
  const d = new Date(calendarMs(iso));
  return `${d.getUTCDate()} de ${MONTHS_LONG[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}
