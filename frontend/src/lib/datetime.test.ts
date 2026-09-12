import { describe, expect, it } from "vitest";

import {
  addDays,
  addMinutes,
  clockTime,
  dayOffset,
  dayShift,
  formatClock,
  formatCountdown,
  formatJourney,
  daysBetween,
  describeWeekdays,
  formatDay,
  minutesBetween,
  offsetForClockTime,
  sriLankaDateTime,
  sriLankaParts,
} from "./datetime";

describe("Sri Lanka time helpers", () => {
  it("reads wall-clock parts in UTC+05:30", () => {
    expect(sriLankaParts("2026-09-15T15:00:00Z")).toEqual({ date: "2026-09-15", time: "20:30" });
    expect(sriLankaParts("2026-09-15T19:00:00Z")).toEqual({ date: "2026-09-16", time: "00:30" });
  });

  it("builds and shifts timestamps", () => {
    const departure = sriLankaDateTime("2026-09-15", "20:30");

    expect(departure).toBe("2026-09-15T20:30:00+05:30");
    expect(addMinutes(departure, 240)).toBe("2026-09-16T00:30:00+05:30");
    expect(minutesBetween(departure, "2026-09-16T05:30:00+05:30")).toBe(540);
  });

  it("rolls stop times past midnight onto the next day", () => {
    // Colombo 20:30 → Dambulla 00:30, after leaving Kurunegala at 22:35 (+125 min).
    expect(offsetForClockTime("00:30", "20:30", 125)).toBe(240);
    expect(offsetForClockTime("21:00", "20:30", 0)).toBe(30);
    expect(offsetForClockTime("20:30", "20:30", 0)).toBe(0);
    expect(offsetForClockTime("nope", "20:30", 0)).toBeNull();
    expect(dayOffset("20:30", 240)).toBe(1);
    expect(dayOffset("20:30", 180)).toBe(0);
    expect(clockTime(20 * 60 + 30 + 540)).toBe("05:30");
  });

  it("works with calendar days", () => {
    expect(formatDay("2026-09-15")).toBe("Tue, 15 Sep 2026");
    expect(formatDay("2026-09-15", { year: false })).toBe("Tue, 15 Sep");
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(daysBetween("2026-09-15", "2026-09-16")).toBe(1);
  });

  it("formats times for customers", () => {
    expect(formatClock("2026-09-15T20:30:00+05:30")).toBe("8:30 PM");
    expect(formatClock("2026-09-16T00:05:00+05:30")).toBe("12:05 AM");
    expect(formatClock("2026-09-16T12:00:00+05:30")).toBe("12:00 PM");
    expect(formatJourney(540)).toBe("9h 00m");
    expect(formatJourney(125)).toBe("2h 05m");
    expect(formatJourney(45)).toBe("45m");
    expect(dayShift("2026-09-15T20:30:00+05:30", "2026-09-16T05:30:00+05:30")).toBe(1);
  });

  it("formats seat-hold countdowns", () => {
    expect(formatCountdown(245_000)).toBe("4:05");
    expect(formatCountdown(59_400)).toBe("1:00");
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(-5_000)).toBe("0:00");
  });

  it("describes weekday sets", () => {
    expect(describeWeekdays([6, 5])).toBe("Weekends");
    expect(describeWeekdays([0, 1, 2, 3, 4])).toBe("Weekdays");
    expect(describeWeekdays([0, 2, 4])).toBe("Mon, Wed, Fri");
  });
});
