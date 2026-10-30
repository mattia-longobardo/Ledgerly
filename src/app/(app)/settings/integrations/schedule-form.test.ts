import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_SCHEDULE, type SyncDays, type SyncSchedule } from "@/platform/integrations/schedule";
import { dayChoice, formRules, normalizeTime, scheduleForm } from "./schedule-form";

const every: SyncDays = { kind: "every" };
const workdays: SyncDays = { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] };

const CASES: [string, SyncSchedule, string][] = [
  ["no rule", { rules: [] }, "manual"],
  ["the default", DEFAULT_SYNC_SCHEDULE, "repeat"],
  [
    "office hours",
    { rules: [{ kind: "interval", everyMinutes: 30, from: "08:00", until: "19:00", days: workdays }] },
    "repeat",
  ],
  ["two times", { rules: [{ kind: "times", times: ["07:30", "22:30"], days: every }] }, "times"],
  [
    "the 1st of the month",
    { rules: [{ kind: "times", times: ["07:00"], days: { kind: "monthDays", monthDays: [1] } }] },
    "times",
  ],
  [
    "an interval the Select does not offer",
    { rules: [{ kind: "interval", everyMinutes: 45, from: "00:00", until: "23:59", days: every }] },
    "custom",
  ],
  ["a cron rule", { rules: [{ kind: "cron", expression: "43 6 * * 1-5" }] }, "custom"],
  [
    "two rules",
    {
      rules: [
        { kind: "times", times: ["06:43"], days: workdays },
        { kind: "cron", expression: "30 18 * * 6,0" },
      ],
    },
    "custom",
  ],
];

describe("scheduleForm", () => {
  it.each(CASES)("reads %s as its mode and gives back the same rules", (_name, schedule, mode) => {
    const form = scheduleForm(schedule);
    expect(form.mode).toBe(mode);
    expect(formRules(form)).toEqual(schedule.rules);
  });
});

describe("dayChoice", () => {
  it("tells the four choices apart", () => {
    expect(dayChoice(every)).toBe("every");
    expect(dayChoice(workdays)).toBe("workdays");
    expect(dayChoice({ kind: "weekdays", weekdays: [6, 7] })).toBe("pick");
    expect(dayChoice({ kind: "monthDays", monthDays: [1] })).toBe("month");
  });
});

describe("normalizeTime", () => {
  it.each([
    ["06:43", "06:43"],
    ["6:43", "06:43"],
    ["6.43", "06:43"],
    ["643", "06:43"],
    ["0643", "06:43"],
    [" 22:30 ", "22:30"],
  ])("reads %s as %s", (typed, time) => {
    expect(normalizeTime(typed)).toBe(time);
  });

  it.each(["", "24:00", "12:60", "7", "abc", "1:2:3"])("refuses %s", (typed) => {
    expect(normalizeTime(typed)).toBeNull();
  });
});
