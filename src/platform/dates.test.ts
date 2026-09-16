import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilDateIn,
  dayOfWeek,
  isCivilDate,
  lastDayOfMonth,
  monthKey,
  monthsApart,
  monthsBetween,
  today,
  utcOffsetLabel,
} from "./dates";

describe("civil dates", () => {
  it("resolves the civil date in the given timezone, not UTC", () => {
    const lateEvening = new Date("2026-09-12T22:30:00Z");
    expect(civilDateIn(lateEvening, "Europe/Rome")).toBe("2026-09-13");
    expect(civilDateIn(lateEvening, "UTC")).toBe("2026-09-12");
    expect(today("Europe/Rome", lateEvening)).toBe("2026-09-13");
  });

  it("validates real calendar dates only", () => {
    expect(isCivilDate("2024-02-29")).toBe(true);
    expect(isCivilDate("2026-02-29")).toBe(false);
    expect(isCivilDate("2026-02-31")).toBe(false);
    expect(isCivilDate("2026-9-1")).toBe(false);
  });

  it("does month arithmetic across year boundaries", () => {
    expect(monthKey("2026-09-13")).toBe("2026-09-01");
    expect(addMonths("2026-12-01", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-01", -1)).toBe("2025-12-01");
    expect(lastDayOfMonth("2026-02-01")).toBe("2026-02-28");
    expect(lastDayOfMonth("2024-02-01")).toBe("2024-02-29");
    expect(monthsBetween("2025-11-01", "2026-02-01")).toEqual([
      "2025-11-01",
      "2025-12-01",
      "2026-01-01",
      "2026-02-01",
    ]);
    expect(monthsBetween("2026-02-01", "2025-11-01")).toEqual([]);
  });

  it("does day arithmetic and weekday lookup", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(dayOfWeek("2026-09-13")).toBe(0);
    expect(dayOfWeek("2026-09-14")).toBe(1);
  });

  it("rejects malformed input instead of guessing", () => {
    expect(() => monthKey("13/09/2026")).toThrow(RangeError);
    expect(() => addDays("2026-02-31", 1)).toThrow(RangeError);
  });
});

describe("monthsApart", () => {
  it("counts whole months in both directions, and zero within one month", () => {
    expect(monthsApart("2026-01-01", "2026-04-01")).toBe(3);
    expect(monthsApart("2026-04-01", "2026-01-01")).toBe(-3);
    expect(monthsApart("2025-11-01", "2026-02-01")).toBe(3);
    expect(monthsApart("2026-01-05", "2026-01-28")).toBe(0);
  });
});

describe("utcOffsetLabel", () => {
  it("names a zone's offset at the given instant, daylight saving included", () => {
    expect(utcOffsetLabel("Europe/Rome", new Date("2026-07-01T12:00:00Z"))).toBe("UTC+2");
    expect(utcOffsetLabel("Europe/Rome", new Date("2026-01-15T12:00:00Z"))).toBe("UTC+1");
    expect(utcOffsetLabel("Asia/Kolkata", new Date("2026-01-15T12:00:00Z"))).toBe("UTC+5:30");
    expect(utcOffsetLabel("America/St_Johns", new Date("2026-01-15T12:00:00Z"))).toBe("UTC−3:30");
    expect(utcOffsetLabel("UTC", new Date("2026-01-15T12:00:00Z"))).toBe("UTC");
  });
});
