import { localParts as local, pad } from "../../convex/lib/dates";

export {
  DAY_MS,
  daysBetween,
  formatIsoLong,
  isoDate,
  shiftDays,
  startOfDay,
} from "../../convex/lib/dates";

// Cozumel time (UTC-5 all year); see convex/lib/dates.ts for the day math.
const TIME_ZONE = "America/Cancun";

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
    timeZone: TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(ms);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
