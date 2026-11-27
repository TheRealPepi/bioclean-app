import { expect, test } from "vitest";
import {
  daysBetween,
  formatIsoLong,
  isIsoDate,
  isoDate,
  localParts,
  shiftDays,
  startOfDay,
  utcOffsetMs,
} from "./dates";

const COZUMEL = "America/Cancun";
// Changes its clocks: UTC-5 in winter, UTC-4 from March 8 to November 1, 2026.
const NEW_YORK = "America/New_York";

test("a day in Cozumel runs from 05:00 UTC to 05:00 UTC, all year", () => {
  for (const day of ["2026-01-15", "2026-07-15"]) {
    expect(startOfDay(day, COZUMEL)).toBe(Date.parse(`${day}T05:00:00Z`));
  }
  // 11:30 p.m. on March 10 in Cozumel is already March 11 in UTC.
  const lateAtNight = Date.parse("2026-03-11T04:30:00Z");
  expect(isoDate(lateAtNight, COZUMEL)).toBe("2026-03-10");
  expect(localParts(lateAtNight, COZUMEL)).toEqual({
    year: 2026,
    month: 2,
    day: 10,
    hours: 23,
    minutes: 30,
  });
});

test("in a zone that changes its clocks, each day starts at its own local midnight", () => {
  expect(startOfDay("2026-01-15", NEW_YORK)).toBe(Date.parse("2026-01-15T05:00:00Z"));
  expect(startOfDay("2026-07-15", NEW_YORK)).toBe(Date.parse("2026-07-15T04:00:00Z"));
  // The days of the change: one has 23 hours and the other 25.
  expect(startOfDay("2026-03-08", NEW_YORK)).toBe(Date.parse("2026-03-08T05:00:00Z"));
  expect(startOfDay("2026-03-09", NEW_YORK)).toBe(Date.parse("2026-03-09T04:00:00Z"));
  expect(startOfDay("2026-11-01", NEW_YORK)).toBe(Date.parse("2026-11-01T04:00:00Z"));
  expect(startOfDay("2026-11-02", NEW_YORK)).toBe(Date.parse("2026-11-02T05:00:00Z"));

  expect(isoDate(Date.parse("2026-07-15T03:59:00Z"), NEW_YORK)).toBe("2026-07-14");
  expect(isoDate(Date.parse("2026-07-15T04:00:00Z"), NEW_YORK)).toBe("2026-07-15");
  expect(utcOffsetMs(Date.parse("2026-07-15T12:00:00Z"), NEW_YORK)).toBe(-4 * 60 * 60 * 1000);
});

test("the same instant can be a different day in each company's zone", () => {
  const instant = Date.parse("2026-06-01T04:30:00Z");
  expect(isoDate(instant, COZUMEL)).toBe("2026-05-31");
  expect(isoDate(instant, NEW_YORK)).toBe("2026-06-01");
});

test("a zone that doesn't exist is an error, never a silent guess", () => {
  expect(() => startOfDay("2026-01-15", "America/Cozumel")).toThrow(RangeError);
});

test("counting days doesn't depend on any zone", () => {
  expect(shiftDays("2026-03-07", 2)).toBe("2026-03-09");
  expect(shiftDays("2026-03-01", -1)).toBe("2026-02-28");
  expect(shiftDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(daysBetween("2026-03-01", "2026-11-30")).toBe(274);
  expect(daysBetween("2026-04-09", "2026-04-02")).toBe(-7);
  expect(formatIsoLong("2026-10-23")).toBe("23 de octubre de 2026");
});

test("only YYYY-MM-DD is a date", () => {
  expect(isIsoDate("2026-06-30")).toBe(true);
  expect(isIsoDate("30/06/2026")).toBe(false);
  expect(isIsoDate("2026-13-01")).toBe(false);
  expect(isIsoDate("2026-6-3")).toBe(false);
  expect(Number.isNaN(startOfDay("mañana", COZUMEL))).toBe(true);
});
