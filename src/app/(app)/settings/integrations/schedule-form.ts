import type { SyncDays, SyncRule, SyncSchedule } from "@/platform/integrations/schedule";

/** The intervals "Repeat" offers. Any other one is still valid: it opens under "Custom rules". */
export const REPEAT_MINUTES = [15, 30, 60, 120, 240, 360, 720] as const;

const WHOLE_DAY = { from: "00:00", until: "23:59" } as const;

/**
 * A schedule as the dialog asks about it (docs/scheduler.md, PERS-158). The stored shape stays a
 * list of rules: this is only how a person reads it, and a schedule that does not fit one of the
 * simple modes opens under "custom", rule by rule, so nothing is lost or rounded by opening it.
 */
export type ScheduleForm =
  | { mode: "manual" }
  | { mode: "repeat"; everyMinutes: number; from: string; until: string; days: SyncDays }
  | { mode: "times"; times: string[]; days: SyncDays }
  | { mode: "custom"; rules: SyncRule[] };

export function scheduleForm(schedule: SyncSchedule): ScheduleForm {
  if (schedule.rules.length === 0) return { mode: "manual" };
  const [rule] = schedule.rules;
  if (schedule.rules.length === 1 && rule.kind === "times") {
    return { mode: "times", times: rule.times, days: rule.days };
  }
  if (
    schedule.rules.length === 1 &&
    rule.kind === "interval" &&
    (REPEAT_MINUTES as readonly number[]).includes(rule.everyMinutes)
  ) {
    return {
      mode: "repeat",
      everyMinutes: rule.everyMinutes,
      from: rule.from,
      until: rule.until,
      days: rule.days,
    };
  }
  return { mode: "custom", rules: schedule.rules };
}

/** The rules a form stands for: the way back from {@link scheduleForm}. */
export function formRules(form: ScheduleForm): SyncRule[] {
  switch (form.mode) {
    case "manual":
      return [];
    case "repeat":
      return [
        {
          kind: "interval",
          everyMinutes: form.everyMinutes,
          from: form.from,
          until: form.until,
          days: form.days,
        },
      ];
    case "times":
      return [{ kind: "times", times: form.times, days: form.days }];
    case "custom":
      return form.rules;
  }
}

/** Whether a repeating rule is limited to part of the day. */
export function isWindowed(from: string, until: string): boolean {
  return from !== WHOLE_DAY.from || until !== WHOLE_DAY.until;
}

export { WHOLE_DAY };

/** How the days of a simple mode are offered: the four choices of the segmented control. */
export type DayChoice = "every" | "workdays" | "pick" | "month";

export function dayChoice(days: SyncDays): DayChoice {
  if (days.kind === "every") return "every";
  if (days.kind === "monthDays") return "month";
  return days.weekdays.join() === "1,2,3,4,5" ? "workdays" : "pick";
}

/**
 * A time as typed, in the one format the app writes: "643", "0643", "6:43" and "6.43" all mean
 * 06:43. `null` when it is not a time of day. The field is text and not `type="time"`, which would
 * show AM/PM or not according to the browser, beside a summary and a preview that use 24 hours.
 */
export function normalizeTime(value: string): string | null {
  const match = /^(\d{1,2})[:.]?(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
