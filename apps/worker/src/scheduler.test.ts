import { describe, expect, it } from "vitest";
import { dueTiers, minuteOf } from "./scheduler";

// The table of the registry, as `cron/crontab` had it until the worker (spec §10.2).
const SCHEDULE = {
  minute: {},
  hourly: { minute: 30 },
  daily: { hour: 12, minute: 0 },
  monthly: { dayOfMonth: 1, hour: 0, minute: 5 },
};
const TIERS = ["minute", "hourly", "daily", "monthly"] as const;
const due = (iso: string) => dueTiers(new Date(iso), TIERS, SCHEDULE, "Europe/Rome");

describe("dueTiers", () => {
  it("starts the minute tier at every minute and nothing else at an ordinary one", () => {
    expect(due("2026-11-18T10:07:00Z")).toEqual(["minute"]);
  });

  it("reads the hours on the clock of Rome, in winter and in summer", () => {
    // 12:00 in Rome is 11:00 UTC in winter (CET) and 10:00 UTC in summer (CEST).
    expect(due("2026-11-18T11:00:00Z")).toEqual(["minute", "daily"]);
    expect(due("2026-07-15T10:00:00Z")).toEqual(["minute", "daily"]);
    expect(due("2026-07-15T11:00:00Z")).toEqual(["minute"]);
  });

  it("starts the hourly tier at :30 of every hour", () => {
    expect(due("2026-11-18T22:30:00Z")).toEqual(["minute", "hourly"]);
    expect(due("2026-11-18T22:31:00Z")).toEqual(["minute"]);
  });

  it("starts the monthly tier at 00:05 of the first day, Rome time", () => {
    // 00:05 on 1 December in Rome is 23:05 UTC on 30 November.
    expect(due("2026-11-30T23:05:00Z")).toEqual(["minute", "monthly"]);
    expect(due("2026-12-01T23:05:00Z")).toEqual(["minute"]);
  });

  it("gives every minute of a day the same instants as the crontab: 1440, 24, 1", () => {
    const counts: Record<string, number> = {};
    const start = Date.parse("2026-03-29T00:00:00+01:00"); // the spring change: a day of 23 hours
    for (let when = start; when < start + 23 * 3_600_000; when += 60_000) {
      for (const tier of due(new Date(when).toISOString())) counts[tier] = (counts[tier] ?? 0) + 1;
    }
    expect(counts).toEqual({ minute: 23 * 60, hourly: 23, daily: 1 });
  });
});

describe("minuteOf", () => {
  it("drops the seconds", () => {
    expect(minuteOf(new Date("2026-11-18T10:07:42.123Z")).toISOString()).toBe("2026-11-18T10:07:00.000Z");
  });
});
