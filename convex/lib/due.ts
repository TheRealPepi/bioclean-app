// Payment deadline of a "credito" delivery and which reminder is due for it.
import { daysBetween, isoDate, shiftDays, startOfDay } from "./dates";

export const WEEK = 7;
/** A deadline reminder that could not be sent is retried for this many days. */
export const CATCH_UP_DAYS = 3;

/** "YYYY-MM-DD": the delivery day in Cozumel plus the client's credit days. */
export function dueDateFor(deliveredAt: number, creditDays: number): string {
  return shiftDays(isoDate(deliveredAt), creditDays);
}

/**
 * The reminder a delivery should get on `today`, if any:
 * - "vencimiento" on the deadline (and a few days after, in case it failed);
 * - "semana_antes" during the week before it. With a week of credit or less
 *   there is no "week before", so only the deadline reminder is sent.
 */
export function reminderDue(
  today: string,
  dueDate: string,
  creditDays: number,
): "semana_antes" | "vencimiento" | null {
  const daysLeft = daysBetween(today, dueDate);
  if (daysLeft <= 0) return daysLeft >= -CATCH_UP_DAYS ? "vencimiento" : null;
  return daysLeft <= WEEK && creditDays > WEEK ? "semana_antes" : null;
}

/**
 * Deliveries made in [from, until) are the only ones that can need a reminder
 * on `today`; `start` is the first delivery day that gets reminders at all.
 */
export function deliveredRange(today: string, creditDays: number, start: string) {
  return {
    from: Math.max(startOfDay(shiftDays(today, -CATCH_UP_DAYS - creditDays)), startOfDay(start)),
    until: startOfDay(shiftDays(today, WEEK + 1 - creditDays)),
  };
}
