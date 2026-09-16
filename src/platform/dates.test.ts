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
  startOfDayIn,
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

describe("startOfDayIn", () => {
  it("is the instant the civil day begins in that zone, not in UTC", () => {
    expect(startOfDayIn("2026-09-13", "UTC").toISOString()).toBe("2026-09-13T00:00:00.000Z");
    // Rome is UTC+2 in September: its midnight is the previous 22:00 UTC.
    expect(startOfDayIn("2026-09-13", "Europe/Rome").toISOString()).toBe("2026-09-12T22:00:00.000Z");
    // …and UTC+1 in January, so the same wall clock is a different instant.
    expect(startOfDayIn("2026-01-13", "Europe/Rome").toISOString()).toBe("2026-01-12T23:00:00.000Z");
    expect(startOfDayIn("2026-09-13", "America/New_York").toISOString()).toBe("2026-09-13T04:00:00.000Z");
  });

  it("round-trips through civilDateIn, which is what the sync relies on", () => {
    for (const zone of ["UTC", "Europe/Rome", "America/New_York", "Pacific/Apia", "Asia/Kolkata"]) {
      for (const on of ["2026-01-01", "2026-03-29", "2026-06-15", "2026-10-25", "2026-12-31"]) {
        expect(civilDateIn(startOfDayIn(on, zone), zone), `${on} in ${zone}`).toBe(on);
      }
    }
  });

  it("lands on the real start of a day whose midnight the clock skips", () => {
    // Santiago springs forward at midnight on 2026-09-06: 00:00 does not exist, and the day
    // starts at 01:00 local. The two-pass offset is what keeps this from drifting a day.
    const start = startOfDayIn("2026-09-06", "America/Santiago");
    expect(civilDateIn(start, "America/Santiago")).toBe("2026-09-06");
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/Santiago",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(start),
    ).toBe("01:00");
  });
});
