// A schedule as a person reads it: the summary on the card, the title of a rule, the interval of
// "Repeat". Every word comes from the catalogue of the editor.
import { LAST_DAY } from "@ledgerly/api-contract";
import type { ScheduleText, SyncDays, SyncRule, SyncSchedule } from "./types";

/** "Mon", "Tue" … in the person's language: ISO weekday 1 = Monday … 7 = Sunday. */
export function weekdayNames(locale: string, width: "short" | "long" = "short"): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" });
  // 2026-01-05 was a Monday.
  return [1, 2, 3, 4, 5, 6, 7].map((day) => format.format(new Date(Date.UTC(2026, 0, 4 + day))));
}

/** An interval as a person says it: "15 min", "2 h", "1 h 30 min". */
export function describeEvery(minutes: number, text: ScheduleText): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return text("units.minutesShort", { n: rest });
  if (rest === 0) return text("units.hoursShort", { n: hours });
  return `${text("units.hoursShort", { n: hours })} ${text("units.minutesShort", { n: rest })}`;
}

function describeDays(days: SyncDays, text: ScheduleText, locale: string): string | null {
  if (days.kind === "every") return null;
  if (days.kind === "weekdays") {
    const names = weekdayNames(locale);
    if (days.weekdays.join() === "1,2,3,4,5") return text("days.workdays");
    if (days.weekdays.join() === "6,7") return text("days.weekend");
    return days.weekdays.map((day) => names[day - 1]).join(", ");
  }
  const numbers = days.monthDays.map((day) => (day === LAST_DAY ? text("days.last") : String(day)));
  return text("days.ofMonth", { days: numbers.join(", ") });
}

const SHOWN_TIMES = 3;

function describeInterval(rule: Extract<SyncRule, { kind: "interval" }>, text: ScheduleText): string {
  const whole = rule.from === "00:00" && rule.until === "23:59";
  if (whole && rule.everyMinutes === 60) return text("summary.hourly");
  const every = text("summary.every", { every: describeEvery(rule.everyMinutes, text) });
  return whole ? every : `${every} ${text("summary.window", { from: rule.from, until: rule.until })}`;
}

function describeTimes(times: readonly string[], text: ScheduleText): string {
  const shown = times.slice(0, SHOWN_TIMES).join(", ");
  const more = times.length - SHOWN_TIMES;
  return more > 0
    ? text("summary.timesMore", { times: shown, more })
    : text("summary.times", { times: shown });
}

/** One rule in a line: "Every 30 min, 08:00–19:00 · Mon–Fri", "At 08:00, 20:00", "Cron 0 7 * * *". */
export function describeRule(rule: SyncRule, text: ScheduleText, locale: string): string {
  if (rule.kind === "cron") return text("summary.cron", { expression: rule.expression });
  const what = rule.kind === "interval" ? describeInterval(rule, text) : describeTimes(rule.times, text);
  const days = describeDays(rule.days, text, locale);
  return days ? `${what} · ${days}` : what;
}

/** A schedule in a line, for the card: the first rule, and how many more there are. */
export function describeSchedule(schedule: SyncSchedule, text: ScheduleText, locale: string): string {
  const [first, ...rest] = schedule.rules;
  if (!first) return text("summary.manual");
  const line = describeRule(first, text, locale);
  return rest.length > 0 ? text("summary.andMore", { rule: line, more: rest.length }) : line;
}
