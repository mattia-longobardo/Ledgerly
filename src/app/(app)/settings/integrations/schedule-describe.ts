import type { SyncDays, SyncRule, SyncSchedule } from "@/platform/integrations/schedule";
import { LAST_DAY } from "@/platform/integrations/schedule";

/**
 * The translator of `settings.integrations.scheduleControl`, reduced to what is used here: the
 * keys are built from a rule, so the caller widens its typed translator to this.
 */
export type T = (key: string, values?: Record<string, string | number>) => string;

/** "Mon", "Tue" … in the person's language: ISO weekday 1 = Monday … 7 = Sunday. */
export function weekdayNames(locale: string, width: "short" | "long" = "short"): string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: width, timeZone: "UTC" });
  // 2026-01-05 was a Monday.
  return [1, 2, 3, 4, 5, 6, 7].map((day) => format.format(new Date(Date.UTC(2026, 0, 4 + day))));
}

/** An interval as a person says it: "15 min", "2 h", "1 h 30 min". */
export function describeEvery(minutes: number, t: T): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return t("units.minutesShort", { n: rest });
  if (rest === 0) return t("units.hoursShort", { n: hours });
  return `${t("units.hoursShort", { n: hours })} ${t("units.minutesShort", { n: rest })}`;
}

function describeDays(days: SyncDays, t: T, locale: string): string | null {
  if (days.kind === "every") return null;
  if (days.kind === "weekdays") {
    const names = weekdayNames(locale);
    if (days.weekdays.join() === "1,2,3,4,5") return t("days.workdays");
    if (days.weekdays.join() === "6,7") return t("days.weekend");
    return days.weekdays.map((day) => names[day - 1]).join(", ");
  }
  const numbers = days.monthDays.map((day) => (day === LAST_DAY ? t("days.last") : String(day)));
  return t("days.ofMonth", { days: numbers.join(", ") });
}

const SHOWN_TIMES = 3;

/** One rule in a line: "Every 30 min, 08:00–19:00 · Mon–Fri", "At 08:00, 20:00", "Cron 0 7 * * *". */
export function describeRule(rule: SyncRule, t: T, locale: string): string {
  if (rule.kind === "cron") return t("summary.cron", { expression: rule.expression });
  let text: string;
  if (rule.kind === "interval") {
    const whole = rule.from === "00:00" && rule.until === "23:59";
    if (whole && rule.everyMinutes === 60) text = t("summary.hourly");
    else {
      text = t("summary.every", { every: describeEvery(rule.everyMinutes, t) });
      if (!whole) text += ` ${t("summary.window", { from: rule.from, until: rule.until })}`;
    }
  } else {
    const shown = rule.times.slice(0, SHOWN_TIMES).join(", ");
    const more = rule.times.length - SHOWN_TIMES;
    text = more > 0 ? t("summary.timesMore", { times: shown, more }) : t("summary.times", { times: shown });
  }
  const days = describeDays(rule.days, t, locale);
  return days ? `${text} · ${days}` : text;
}

/** A schedule in a line, for the card: the first rule, and how many more there are. */
export function describeSchedule(schedule: SyncSchedule, t: T, locale: string): string {
  const [first, ...rest] = schedule.rules;
  if (!first) return t("summary.manual");
  const text = describeRule(first, t, locale);
  return rest.length > 0 ? t("summary.andMore", { rule: text, more: rest.length }) : text;
}
