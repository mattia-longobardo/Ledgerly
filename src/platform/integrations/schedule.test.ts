import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_SCHEDULE,
  nextSyncAt,
  parseSyncSchedule,
  slotsOf,
  type SyncSchedule,
  syncScheduleSchema,
} from "./rules";

const ROME = "Europe/Rome";
const at = (iso: string) => new Date(iso);

describe("syncScheduleSchema", () => {
  it("accepts the three shapes and sorts and deduplicates the times", () => {
    expect(syncScheduleSchema.parse({ mode: "interval", everyMinutes: 15 })).toEqual({
      mode: "interval",
      everyMinutes: 15,
    });
    expect(syncScheduleSchema.parse({ mode: "times", times: ["19:30", "07:00", "19:30"] })).toEqual({
      mode: "times",
      times: ["07:00", "19:30"],
    });
    expect(syncScheduleSchema.parse({ mode: "manual" })).toEqual({ mode: "manual" });
  });

  it("refuses an interval off the list, a time off the quarter hour, too many times, no time", () => {
    expect(syncScheduleSchema.safeParse({ mode: "interval", everyMinutes: 5 }).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ mode: "interval", everyMinutes: 45 }).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ mode: "times", times: ["07:10"] }).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ mode: "times", times: ["24:00"] }).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ mode: "times", times: [] }).success).toBe(false);
    const seven = ["00:00", "01:00", "02:00", "03:00", "04:00", "05:00", "06:00"];
    expect(syncScheduleSchema.safeParse({ mode: "times", times: seven }).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ mode: "cron", expression: "* * * * *" }).success).toBe(false);
  });

  it("reads a stored value that no longer parses as the default", () => {
    expect(parseSyncSchedule({ mode: "weird" })).toEqual(DEFAULT_SYNC_SCHEDULE);
    expect(parseSyncSchedule(null)).toEqual(DEFAULT_SYNC_SCHEDULE);
  });
});

describe("nextSyncAt", () => {
  it("keeps today's cadence by default: the next top of the hour", () => {
    expect(nextSyncAt(DEFAULT_SYNC_SCHEDULE, ROME, at("2026-10-27T09:07:00Z"))).toEqual(
      at("2026-10-27T10:00:00Z"),
    );
    // Exactly on a slot: strictly after, so the slot just run is not run twice.
    expect(nextSyncAt(DEFAULT_SYNC_SCHEDULE, ROME, at("2026-10-27T10:00:00Z"))).toEqual(
      at("2026-10-27T11:00:00Z"),
    );
  });

  it("aligns intervals to local midnight", () => {
    const six: SyncSchedule = { mode: "interval", everyMinutes: 360 };
    // 13:30 in Rome (UTC+1 in winter) → 18:00 local = 17:00Z.
    expect(nextSyncAt(six, ROME, at("2026-11-10T12:30:00Z"))).toEqual(at("2026-11-10T17:00:00Z"));
    // 23:30 local → midnight of the next local day.
    expect(nextSyncAt(six, ROME, at("2026-11-10T22:30:00Z"))).toEqual(at("2026-11-10T23:00:00Z"));
    const quarter: SyncSchedule = { mode: "interval", everyMinutes: 15 };
    expect(nextSyncAt(quarter, ROME, at("2026-11-10T12:22:00Z"))).toEqual(at("2026-11-10T12:30:00Z"));
  });

  it("runs at the chosen local times, across midnight and the end of a month", () => {
    const twice: SyncSchedule = { mode: "times", times: ["07:00", "19:30"] };
    expect(nextSyncAt(twice, ROME, at("2026-11-10T07:00:00Z"))).toEqual(at("2026-11-10T18:30:00Z"));
    expect(nextSyncAt(twice, ROME, at("2026-11-30T19:00:00Z"))).toEqual(at("2026-12-01T06:00:00Z"));
    expect(nextSyncAt(twice, ROME, at("2026-12-31T22:00:00Z"))).toEqual(at("2027-01-01T06:00:00Z"));
  });

  it("keeps 07:00 at 07:00 local across the changes of daylight saving time", () => {
    const morning: SyncSchedule = { mode: "times", times: ["07:00"] };
    // Rome leaves summer time on 2026-10-25: 07:00 is 05:00Z before, 06:00Z after.
    expect(nextSyncAt(morning, ROME, at("2026-10-24T06:00:00Z"))).toEqual(at("2026-10-25T06:00:00Z"));
    expect(nextSyncAt(morning, ROME, at("2026-10-23T06:00:00Z"))).toEqual(at("2026-10-24T05:00:00Z"));
    // And enters it on 2026-03-29: 07:00 is 06:00Z before, 05:00Z after.
    expect(nextSyncAt(morning, ROME, at("2026-03-28T07:00:00Z"))).toEqual(at("2026-03-29T05:00:00Z"));
  });

  it("runs a time inside the spring gap an hour on, as the clock does", () => {
    // 02:30 does not exist in Rome on 2026-03-29 (02:00 → 03:00): it runs at 03:30, an hour on.
    const gap: SyncSchedule = { mode: "times", times: ["02:30"] };
    expect(nextSyncAt(gap, ROME, at("2026-03-28T23:00:00Z"))).toEqual(at("2026-03-29T01:30:00Z"));
  });

  it("follows the person's zone", () => {
    const morning: SyncSchedule = { mode: "times", times: ["07:00"] };
    expect(nextSyncAt(morning, "America/New_York", at("2026-11-10T00:00:00Z"))).toEqual(
      at("2026-11-10T12:00:00Z"),
    );
  });

  it("is null for a manual schedule", () => {
    expect(nextSyncAt({ mode: "manual" }, ROME, at("2026-11-10T00:00:00Z"))).toBeNull();
    expect(slotsOf({ mode: "manual" })).toEqual([]);
  });

  it("has 96 slots a day at 15 minutes and 1 at a day", () => {
    expect(slotsOf({ mode: "interval", everyMinutes: 15 })).toHaveLength(96);
    expect(slotsOf({ mode: "interval", everyMinutes: 1440 })).toEqual([0]);
  });
});
