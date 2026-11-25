import { expect, test } from "vitest";
import { DAY_MS, shiftDays, startOfDay } from "./dates";
import { deliveredRange, dueDateFor, reminderDue } from "./due";

test("the deadline counts from the delivery day in Cozumel, not in UTC", () => {
  // 11:30 p.m. on March 10 in Cozumel is already March 11 in UTC.
  const lateAtNight = Date.parse("2026-03-11T04:30:00Z");
  expect(dueDateFor(lateAtNight, 30)).toBe("2026-04-09");
  expect(dueDateFor(lateAtNight, 1)).toBe("2026-03-11");
});

test("reminders go out during the week before the deadline and on the day", () => {
  const due = "2026-04-09";
  const daysBefore = (n: number) => reminderDue(shiftDays(due, -n), due, 30);
  expect(daysBefore(8)).toBeNull();
  expect(daysBefore(7)).toBe("semana_antes");
  expect(daysBefore(1)).toBe("semana_antes");
  expect(daysBefore(0)).toBe("vencimiento");
});

test("a deadline reminder that failed is retried for three days, then dropped", () => {
  const due = "2026-04-09";
  expect(reminderDue(shiftDays(due, 3), due, 30)).toBe("vencimiento");
  expect(reminderDue(shiftDays(due, 4), due, 30)).toBeNull();
});

test("with a week of credit or less there is no reminder before the deadline", () => {
  const due = "2026-04-09";
  expect(reminderDue(shiftDays(due, -5), due, 7)).toBeNull();
  expect(reminderDue(due, due, 7)).toBe("vencimiento");
});

test("every delivery that needs a reminder today is inside the range that gets searched", () => {
  const today = "2026-06-15";
  let due = 0;
  for (const creditDays of [1, 7, 8, 30, 90]) {
    const { from, until } = deliveredRange(today, creditDays, "2020-01-01");
    for (let offset = -120; offset <= 10; offset++) {
      const deliveredAt = startOfDay(shiftDays(today, offset)) + DAY_MS / 2;
      if (reminderDue(today, dueDateFor(deliveredAt, creditDays), creditDays) === null) continue;
      due++;
      expect(deliveredAt, `${creditDays} days of credit, delivered ${offset} days from today`)
        .toBeGreaterThanOrEqual(from);
      expect(deliveredAt).toBeLessThan(until);
    }
  }
  expect(due).toBeGreaterThan(0);
});

test("deliveries from before reminders were turned on are never searched", () => {
  const { from } = deliveredRange("2026-06-15", 30, "2026-06-01");
  expect(from).toBe(startOfDay("2026-06-01"));
});
