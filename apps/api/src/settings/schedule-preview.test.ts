// The preview of a schedule on the server answers what the editor computed in the browser before R3
// (`schedule-control.tsx`), and the contract's limits are the domain's.
import { describe, expect, it } from "vitest";
import {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  SCHEDULE_PREVIEW_COUNT,
  syncScheduleSchema,
} from "@ledgerly/api-contract";
import { civilDateIn } from "@domain/shared/dates";
import * as domain from "@domain/platform/integrations/schedule";

/** What the browser did: the domain's schema, then the problems, then the next five passes. */
function browserPreview(rules: unknown[], timeZone: string, now: Date) {
  const parsed = domain.syncScheduleSchema.safeParse({ rules });
  if (!parsed.success) return null;
  const problems = domain.scheduleProblems(parsed.data, civilDateIn(now, timeZone));
  const next = problems.length === 0 ? domain.nextSyncTimes(parsed.data, timeZone, now, 5) : [];
  return { next, problems };
}

const EVERY = { kind: "every" } as const;
const SCHEDULES: unknown[][] = [
  [],
  [{ kind: "interval", everyMinutes: 60, from: "00:00", until: "23:59", days: EVERY }],
  [{ kind: "times", times: ["07:00", "13:00", "19:00"], days: { kind: "weekdays", weekdays: [1, 3, 5] } }],
  [{ kind: "times", times: ["06:30"], days: { kind: "monthDays", monthDays: [1, LAST_DAY] } }],
  [{ kind: "cron", expression: "30 2 * * sun" }],
  // Problems: two rules 10 minutes apart, a cron that never runs.
  [
    { kind: "times", times: ["07:00"], days: EVERY },
    { kind: "times", times: ["07:10"], days: EVERY },
  ],
  [{ kind: "cron", expression: "0 0 31 2 *" }],
  // Across a change of daylight saving time (Rome, last Sunday of March and of October).
  [{ kind: "times", times: ["02:30"], days: EVERY }],
];
const ZONES = ["Europe/Rome", "America/New_York", "Asia/Kolkata"];
const NOWS = [
  new Date("2026-03-27T12:00:00Z"),
  new Date("2026-10-23T23:59:00Z"),
  new Date("2026-11-19T01:00:00Z"),
];

describe("POST /connections/{id}/schedule/preview", () => {
  it("answers the same passes and problems the browser computed", () => {
    for (const rules of SCHEDULES) {
      for (const zone of ZONES) {
        for (const now of NOWS) {
          const label = `${JSON.stringify(rules)} ${zone} ${now.toISOString()}`;
          expect(syncScheduleSchema.safeParse({ rules }).success, label).toBe(true);
          expect(domain.previewSchedule(rules, zone, now, { count: SCHEDULE_PREVIEW_COUNT }), label).toEqual(
            browserPreview(rules, zone, now),
          );
        }
      }
    }
  });

  it("names a rule the server refuses, which the contract's shape lets in", () => {
    const rules = [
      { kind: "times", times: ["07:00"], days: EVERY },
      { kind: "cron", expression: "61 * * * *" },
    ];
    expect(syncScheduleSchema.safeParse({ rules }).success).toBe(true);
    expect(browserPreview(rules, "Europe/Rome", NOWS[0])).toBeNull();
    expect(domain.previewSchedule(rules, "Europe/Rome", NOWS[0], { count: 5 })).toEqual({
      next: [],
      problems: [{ code: "invalidRule", rule: 1 }],
    });
  });
});

describe("the contract's limits of a schedule", () => {
  it("are the domain's", () => {
    expect({ LAST_DAY, MAX_RULES, MAX_TIMES, MIN_SYNC_GAP_MINUTES }).toEqual({
      LAST_DAY: domain.LAST_DAY,
      MAX_RULES: domain.MAX_RULES,
      MAX_TIMES: domain.MAX_TIMES,
      MIN_SYNC_GAP_MINUTES: domain.MIN_SYNC_GAP_MINUTES,
    });
  });

  it("refuse and accept at the same edges as the domain", () => {
    const interval = (everyMinutes: number, from = "08:00", until = "20:00") => ({
      kind: "interval",
      everyMinutes,
      from,
      until,
      days: EVERY,
    });
    const times = (count: number) => ({
      kind: "times",
      times: Array.from(
        { length: count },
        (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`,
      ),
      days: EVERY,
    });
    const cases: unknown[][] = [
      [interval(MIN_SYNC_GAP_MINUTES)],
      [interval(MIN_SYNC_GAP_MINUTES - 1)],
      [interval(24 * 60)],
      [interval(24 * 60 + 1)],
      [interval(60, "20:00", "08:00")],
      [times(MAX_TIMES)],
      [times(MAX_TIMES + 1)],
      [{ kind: "times", times: ["24:00"], days: EVERY }],
      [{ kind: "times", times: ["07:00"], days: { kind: "monthDays", monthDays: [0] } }],
      [{ kind: "times", times: ["07:00"], days: { kind: "weekdays", weekdays: [8] } }],
      Array.from({ length: MAX_RULES }, () => interval(60)),
      Array.from({ length: MAX_RULES + 1 }, () => interval(60)),
    ];
    for (const rules of cases) {
      expect(syncScheduleSchema.safeParse({ rules }).success, JSON.stringify(rules)).toBe(
        domain.syncScheduleSchema.safeParse({ rules }).success,
      );
    }
  });
});
