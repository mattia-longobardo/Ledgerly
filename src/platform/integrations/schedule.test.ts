import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_SCHEDULE,
  fromLegacy,
  MIN_SYNC_GAP_MINUTES,
  nextSyncAfterPass,
  nextSyncAt,
  nextSyncTimes,
  parseCron,
  parseSyncSchedule,
  ruleMinutesOn,
  scheduleProblems,
  type SyncRule,
  type SyncSchedule,
  syncScheduleSchema,
} from "./schedule";

const ROME = "Europe/Rome";
const at = (iso: string) => new Date(iso);
const every = { kind: "every" } as const;
const times = (list: string[]): SyncSchedule => ({ rules: [{ kind: "times", times: list, days: every }] });

describe("syncScheduleSchema", () => {
  it("accepts every kind of rule, and sorts and deduplicates times and days", () => {
    const parsed = syncScheduleSchema.parse({
      rules: [
        { kind: "interval", everyMinutes: 15, from: "08:00", until: "19:00", days: { kind: "every" } },
        {
          kind: "times",
          times: ["19:30", "06:43", "19:30"],
          days: { kind: "weekdays", weekdays: [5, 1, 1] },
        },
        { kind: "cron", expression: "  43  6 * * 1-5 " },
        { kind: "times", times: ["07:00"], days: { kind: "monthDays", monthDays: [15, -1, 1] } },
      ],
    });
    expect(parsed.rules[1]).toEqual({
      kind: "times",
      times: ["06:43", "19:30"],
      days: { kind: "weekdays", weekdays: [1, 5] },
    });
    expect(parsed.rules[2]).toEqual({ kind: "cron", expression: "43 6 * * 1-5" });
    expect(parsed.rules[3]).toMatchObject({ days: { monthDays: [-1, 1, 15] } });
    expect(syncScheduleSchema.parse({ rules: [] })).toEqual({ rules: [] });
  });

  it("refuses an interval under the gap or over a day, a window backwards, no day, a bad time or cron", () => {
    const interval = (rule: object) => ({
      rules: [{ kind: "interval", everyMinutes: 60, from: "00:00", until: "23:59", days: every, ...rule }],
    });
    expect(syncScheduleSchema.safeParse(interval({ everyMinutes: MIN_SYNC_GAP_MINUTES - 1 })).success).toBe(
      false,
    );
    expect(syncScheduleSchema.safeParse(interval({ everyMinutes: 1441 })).success).toBe(false);
    expect(syncScheduleSchema.safeParse(interval({ everyMinutes: 20.5 })).success).toBe(false);
    expect(syncScheduleSchema.safeParse(interval({ from: "20:00", until: "08:00" })).success).toBe(false);
    expect(syncScheduleSchema.safeParse(interval({ days: { kind: "weekdays", weekdays: [] } })).success).toBe(
      false,
    );
    expect(
      syncScheduleSchema.safeParse(interval({ days: { kind: "monthDays", monthDays: [32] } })).success,
    ).toBe(false);
    expect(syncScheduleSchema.safeParse(times(["24:00"])).success).toBe(false);
    expect(syncScheduleSchema.safeParse(times(["7:00"])).success).toBe(false);
    expect(syncScheduleSchema.safeParse(times([])).success).toBe(false);
    expect(syncScheduleSchema.safeParse({ rules: [{ kind: "cron", expression: "* * * *" }] }).success).toBe(
      false,
    );
    expect(
      syncScheduleSchema.safeParse({ rules: [{ kind: "cron", expression: "61 * * * *" }] }).success,
    ).toBe(false);
    const nine = Array.from({ length: 9 }, () => DEFAULT_SYNC_SCHEDULE.rules[0]);
    expect(syncScheduleSchema.safeParse({ rules: nine }).success).toBe(false);
  });
});

describe("the D7 schedules, as migration 0034 converts them", () => {
  it("keeps every choice: interval, times and manual", () => {
    expect(fromLegacy({ mode: "interval", everyMinutes: 60 })).toEqual(DEFAULT_SYNC_SCHEDULE);
    expect(fromLegacy({ mode: "times", times: ["07:00", "19:30"] })).toEqual(times(["07:00", "19:30"]));
    expect(fromLegacy({ mode: "manual" })).toEqual({ rules: [] });
    expect(fromLegacy({ rules: [] })).toBeNull();
  });

  it("runs an old six-hour interval at the same instants as D7 did", () => {
    const six = parseSyncSchedule({ mode: "interval", everyMinutes: 360 });
    expect(nextSyncAt(six, ROME, at("2026-11-10T12:30:00Z"))).toEqual(at("2026-11-10T17:00:00Z"));
    expect(nextSyncAt(six, ROME, at("2026-11-10T22:30:00Z"))).toEqual(at("2026-11-10T23:00:00Z"));
  });

  it("reads anything unreadable as the default, never a crash", () => {
    expect(parseSyncSchedule({ mode: "weird" })).toEqual(DEFAULT_SYNC_SCHEDULE);
    expect(parseSyncSchedule(null)).toEqual(DEFAULT_SYNC_SCHEDULE);
  });
});

describe("parseCron", () => {
  it("reads lists, ranges, steps and names; 7 is Sunday", () => {
    const cron = parseCron("0,30 8-18/2 * jan-mar mon-fri")!;
    expect([...cron.minutes]).toEqual([0, 30]);
    expect([...cron.hours]).toEqual([8, 10, 12, 14, 16, 18]);
    expect([...cron.months]).toEqual([1, 2, 3]);
    expect([...cron.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect([...parseCron("0 0 * * 7")!.weekdays]).toEqual([0]);
    expect([...parseCron("5/20 * * * *")!.minutes]).toEqual([5, 25, 45]);
  });

  it("refuses what is not a cron", () => {
    for (const bad of [
      "",
      "* * * *",
      "60 * * * *",
      "* 24 * * *",
      "* * 0 * *",
      "* * * 13 *",
      "1-0 * * * *",
      "*/0 * * * *",
      "@daily",
    ]) {
      expect(parseCron(bad), bad).toBeNull();
    }
  });

  it("matches either day field when both are restricted, as every cron does", () => {
    const rule: SyncRule = { kind: "cron", expression: "0 7 1 * 1" };
    expect(ruleMinutesOn(rule, "2026-11-01")).toEqual([420]); // the 1st, a Sunday
    expect(ruleMinutesOn(rule, "2026-11-02")).toEqual([420]); // a Monday
    expect(ruleMinutesOn(rule, "2026-11-03")).toEqual([]);
  });
});

describe("nextSyncTimes", () => {
  it("runs at 06:43 to the minute", () => {
    expect(nextSyncAt(times(["06:43"]), ROME, at("2026-11-10T05:00:00Z"))).toEqual(
      at("2026-11-10T05:43:00Z"),
    );
  });

  it("keeps today's cadence by default: the next top of the hour, strictly after", () => {
    expect(nextSyncAt(DEFAULT_SYNC_SCHEDULE, ROME, at("2026-10-27T09:07:00Z"))).toEqual(
      at("2026-10-27T10:00:00Z"),
    );
    expect(nextSyncAt(DEFAULT_SYNC_SCHEDULE, ROME, at("2026-10-27T10:00:00Z"))).toEqual(
      at("2026-10-27T11:00:00Z"),
    );
  });

  it("repeats an interval from its start to its end, on its days only", () => {
    const office: SyncSchedule = {
      rules: [
        {
          kind: "interval",
          everyMinutes: 90,
          from: "08:15",
          until: "12:00",
          days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] },
        },
      ],
    };
    // Friday 13 November 2026, 11:00 in Rome: 11:15, then Monday 08:15, 09:45, 11:15.
    expect(nextSyncTimes(office, ROME, at("2026-11-13T10:00:00Z"), 4)).toEqual([
      at("2026-11-13T10:15:00Z"),
      at("2026-11-16T07:15:00Z"),
      at("2026-11-16T08:45:00Z"),
      at("2026-11-16T10:15:00Z"),
    ]);
  });

  it("merges two rules in time order and runs a shared minute once", () => {
    const combined: SyncSchedule = {
      rules: [
        { kind: "times", times: ["06:43", "12:00"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } },
        { kind: "cron", expression: "0 12,20 * * *" },
      ],
    };
    // Saturday 14 November 2026, 00:00 in Rome.
    expect(nextSyncTimes(combined, ROME, at("2026-11-13T23:00:00Z"), 6)).toEqual([
      at("2026-11-14T11:00:00Z"), // Sat 12:00 (cron)
      at("2026-11-14T19:00:00Z"), // Sat 20:00 (cron)
      at("2026-11-15T11:00:00Z"), // Sun 12:00
      at("2026-11-15T19:00:00Z"), // Sun 20:00
      at("2026-11-16T05:43:00Z"), // Mon 06:43 (times)
      at("2026-11-16T11:00:00Z"), // Mon 12:00, both rules: once
    ]);
  });

  it("runs on chosen days of the month, the last one included", () => {
    const monthly: SyncSchedule = {
      rules: [{ kind: "times", times: ["07:00"], days: { kind: "monthDays", monthDays: [31, -1] } }],
    };
    // November has no 31st: its last day, the 30th; then 31 December (both the 31st and the last).
    expect(nextSyncTimes(monthly, ROME, at("2026-11-01T00:00:00Z"), 2)).toEqual([
      at("2026-11-30T06:00:00Z"),
      at("2026-12-31T06:00:00Z"),
    ]);
    // February 2027.
    expect(nextSyncAt(monthly, ROME, at("2027-02-01T00:00:00Z"))).toEqual(at("2027-02-28T06:00:00Z"));
  });

  it("finds a cron that runs once in four years", () => {
    const leap: SyncSchedule = { rules: [{ kind: "cron", expression: "0 9 29 2 *" }] };
    expect(nextSyncAt(leap, ROME, at("2026-11-01T00:00:00Z"))).toEqual(at("2028-02-29T08:00:00Z"));
  });

  it("keeps 07:00 at 07:00 local across both changes of daylight saving time", () => {
    const morning = times(["07:00"]);
    // Rome leaves summer time on 2026-10-25: 07:00 is 05:00Z before, 06:00Z after.
    expect(nextSyncTimes(morning, ROME, at("2026-10-23T06:00:00Z"), 2)).toEqual([
      at("2026-10-24T05:00:00Z"),
      at("2026-10-25T06:00:00Z"),
    ]);
    // And enters it on 2026-03-29: 07:00 is 06:00Z before, 05:00Z after.
    expect(nextSyncAt(morning, ROME, at("2026-03-28T07:00:00Z"))).toEqual(at("2026-03-29T05:00:00Z"));
  });

  it("runs a time inside the spring gap an hour on, and a time of the repeated hour once", () => {
    // 02:30 does not exist in Rome on 2026-03-29 (02:00 → 03:00): it runs at 03:30, an hour on.
    expect(nextSyncAt(times(["02:30"]), ROME, at("2026-03-28T23:00:00Z"))).toEqual(
      at("2026-03-29T01:30:00Z"),
    );
    // 02:30 happens twice on 2026-10-25 (03:00 → 02:00): it runs at the first, then the next day.
    expect(nextSyncTimes(times(["02:30"]), ROME, at("2026-10-24T22:00:00Z"), 2)).toEqual([
      at("2026-10-25T00:30:00Z"),
      at("2026-10-26T01:30:00Z"),
    ]);
  });

  it("keeps an interval on the wall clock through the autumn night", () => {
    const hourly = DEFAULT_SYNC_SCHEDULE;
    // 01:00, 02:00 (the first), 03:00 local on 2026-10-25: 23:00Z, 00:00Z, 02:00Z.
    expect(nextSyncTimes(hourly, ROME, at("2026-10-24T22:30:00Z"), 3)).toEqual([
      at("2026-10-24T23:00:00Z"),
      at("2026-10-25T00:00:00Z"),
      at("2026-10-25T02:00:00Z"),
    ]);
  });

  it("follows the person's zone", () => {
    expect(nextSyncAt(times(["07:00"]), "America/New_York", at("2026-11-10T00:00:00Z"))).toEqual(
      at("2026-11-10T12:00:00Z"),
    );
  });

  it("is empty for a manual schedule", () => {
    expect(nextSyncTimes({ rules: [] }, ROME, at("2026-11-10T00:00:00Z"), 5)).toEqual([]);
    expect(nextSyncAt({ rules: [] }, ROME, at("2026-11-10T00:00:00Z"))).toBeNull();
  });
});

describe("nextSyncAfterPass", () => {
  it("moves to the next slot after the one just run, even when the tick came a minute late", () => {
    const quarter: SyncSchedule = {
      rules: [{ kind: "interval", everyMinutes: 15, from: "00:00", until: "23:59", days: every }],
    };
    expect(nextSyncAfterPass(quarter, ROME, at("2026-11-10T06:45:00Z"), at("2026-11-10T06:46:10Z"))).toEqual(
      at("2026-11-10T07:00:00Z"),
    );
  });

  it("never comes back sooner than the minimum gap, nor runs a missed slot twice", () => {
    const close: SyncSchedule = times(["06:43", "06:50", "07:30"]);
    expect(nextSyncAfterPass(close, ROME, at("2026-11-10T05:43:00Z"), at("2026-11-10T05:43:05Z"))).toEqual(
      at("2026-11-10T06:30:00Z"),
    );
    // Down for hours: one pass now, then the next slot to come — no catching up.
    expect(nextSyncAfterPass(close, ROME, at("2026-11-09T05:43:00Z"), at("2026-11-10T06:00:00Z"))).toEqual(
      at("2026-11-10T06:30:00Z"),
    );
  });
});

describe("scheduleProblems", () => {
  const today = "2026-11-10";

  it("accepts the default, a manual schedule and 96 passes a day", () => {
    expect(scheduleProblems(DEFAULT_SYNC_SCHEDULE, today)).toEqual([]);
    expect(scheduleProblems({ rules: [] }, today)).toEqual([]);
    const quarter: SyncSchedule = {
      rules: [{ kind: "interval", everyMinutes: 15, from: "00:00", until: "23:59", days: every }],
    };
    expect(scheduleProblems(quarter, today)).toEqual([]);
  });

  it("refuses two passes closer than the gap, across rules and across midnight", () => {
    expect(scheduleProblems(times(["06:43", "06:50"]), today)).toEqual([
      { code: "tooFrequent", day: today, first: "06:43", second: "06:50" },
    ]);
    const midnight: SyncSchedule = {
      rules: [
        { kind: "times", times: ["23:55"], days: every },
        { kind: "times", times: ["00:05"], days: every },
      ],
    };
    expect(scheduleProblems(midnight, today)[0]).toMatchObject({
      code: "tooFrequent",
      first: "23:55",
      second: "00:05",
    });
    expect(
      scheduleProblems({ rules: [{ kind: "cron", expression: "*/5 * * * *" }] }, today)[0],
    ).toMatchObject({
      code: "tooFrequent",
    });
  });

  it("refuses a rule that never runs", () => {
    const never: SyncSchedule = {
      rules: [DEFAULT_SYNC_SCHEDULE.rules[0], { kind: "cron", expression: "0 7 31 2 *" }],
    };
    expect(scheduleProblems(never, today)).toEqual([{ code: "neverRuns", rule: 1 }]);
  });
});
