/**
 * When a connection syncs (docs/scheduler.md, which replaces docs/auth-design.md D7). Pure and
 * free of `server-only`: the editor in Settings › Integrations runs the same functions in the
 * browser for its preview, and the dispatcher runs them on the server for the real next pass.
 *
 * A schedule is a list of rules, and the connection runs at every minute any rule names (their
 * union). No rule at all is "manual": only "Sync now" starts a pass. Every time is a local
 * wall-clock time in the person's own zone, to the minute.
 */
import { z } from "zod";
import {
  addDays,
  type CivilDate,
  civilDateIn,
  dayOfWeek,
  lastDayOfMonth,
  monthKey,
  wallClockIn,
} from "@/platform/dates";

/**
 * The shortest gap between two passes of one connection, over all its rules together. Every pass
 * is several calls to the provider (Wallet: accounts, then the records window page by page), and
 * Wallet's API is unofficial and publishes no quota: 15 minutes is the floor D7 already ran on
 * without a 429, and at most 96 passes a day per connection.
 */
export const MIN_SYNC_GAP_MINUTES = 15;
/** The longest interval a rule may repeat at: a rule restarts every day at its `from`. */
export const MAX_INTERVAL_MINUTES = 24 * 60;
export const MAX_RULES = 8;
/** One rule's times: as many as the gap allows in a day. */
export const MAX_TIMES = (24 * 60) / MIN_SYNC_GAP_MINUTES;
/** How far ahead a schedule is looked at: a cron that names 29 February runs once in four years. */
export const HORIZON_DAYS = 4 * 366 + 7;
/** How far ahead the gap between passes is checked: every weekday of every kind of month. */
export const GAP_CHECK_DAYS = 400;

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeOfDay = z.string().regex(TIME_OF_DAY);

/** ISO weekdays: 1 = Monday … 7 = Sunday. `-1` as a day of the month is its last day. */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export const LAST_DAY = -1;

const sortedUnique = <T extends number | string>(values: T[]): T[] =>
  [...new Set(values)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

const daysSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("every") }),
  z.object({
    kind: z.literal("weekdays"),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).transform(sortedUnique),
  }),
  z.object({
    kind: z.literal("monthDays"),
    monthDays: z
      .array(
        z
          .number()
          .int()
          .refine((day) => day === LAST_DAY || (day >= 1 && day <= 31)),
      )
      .min(1)
      .max(32)
      .transform(sortedUnique),
  }),
]);
export type SyncDays = z.output<typeof daysSchema>;

export const intervalRuleSchema = z
  .object({
    kind: z.literal("interval"),
    everyMinutes: z.number().int().min(MIN_SYNC_GAP_MINUTES).max(MAX_INTERVAL_MINUTES),
    from: timeOfDay,
    until: timeOfDay,
    days: daysSchema,
  })
  .refine((rule) => rule.until >= rule.from, { path: ["until"] });

export const timesRuleSchema = z.object({
  kind: z.literal("times"),
  times: z.array(timeOfDay).min(1).max(MAX_TIMES).transform(sortedUnique),
  days: daysSchema,
});

export const cronRuleSchema = z.object({
  kind: z.literal("cron"),
  expression: z
    .string()
    .trim()
    .max(120)
    .transform((value) => value.split(/\s+/).join(" "))
    .refine((value) => parseCron(value) !== null),
});

export const syncRuleSchema = z.union([intervalRuleSchema, timesRuleSchema, cronRuleSchema]);
export type SyncRule = z.output<typeof syncRuleSchema>;
export type IntervalRule = Extract<SyncRule, { kind: "interval" }>;
export type TimesRule = Extract<SyncRule, { kind: "times" }>;
export type CronRule = Extract<SyncRule, { kind: "cron" }>;
export type RuleKind = SyncRule["kind"];

/** The shape a stored or submitted schedule must have. `rules: []` is "manual". */
export const syncScheduleSchema = z.object({ rules: z.array(syncRuleSchema).max(MAX_RULES) });
export type SyncSchedule = z.output<typeof syncScheduleSchema>;

const EVERY_DAY: SyncDays = { kind: "every" };

/** The default of every connection, and the behaviour before D7: once an hour, on the hour. */
export const DEFAULT_SYNC_SCHEDULE: SyncSchedule = {
  rules: [{ kind: "interval", everyMinutes: 60, from: "00:00", until: "23:59", days: EVERY_DAY }],
};

/**
 * A D7 schedule (`{mode: interval|times|manual}`) in the rule shape it means. Migration 0034
 * converts the stored ones; this keeps a value written by a rolled-back image readable.
 */
export function fromLegacy(value: unknown): SyncSchedule | null {
  if (typeof value !== "object" || value === null || !("mode" in value)) return null;
  const legacy = value as { mode: unknown; everyMinutes?: unknown; times?: unknown };
  if (legacy.mode === "manual") return { rules: [] };
  if (legacy.mode === "interval" && typeof legacy.everyMinutes === "number") {
    return {
      rules: [
        {
          kind: "interval",
          everyMinutes: legacy.everyMinutes,
          from: "00:00",
          until: "23:59",
          days: EVERY_DAY,
        },
      ],
    };
  }
  if (legacy.mode === "times" && Array.isArray(legacy.times)) {
    return { rules: [{ kind: "times", times: legacy.times as string[], days: EVERY_DAY }] };
  }
  return null;
}

/** A stored schedule read back: a D7 shape is converted, anything unreadable is the default. */
export function parseSyncSchedule(value: unknown): SyncSchedule {
  const parsed = syncScheduleSchema.safeParse(fromLegacy(value) ?? value);
  return parsed.success ? parsed.data : DEFAULT_SYNC_SCHEDULE;
}

export function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/* A five-field cron expression: minute hour day-of-month month day-of-week */

export interface CronFields {
  minutes: Set<number>;
  hours: Set<number>;
  monthDays: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  /** Whether day-of-month and day-of-week were both restricted: then either one matches (cron). */
  eitherDay: boolean;
  monthDaysAny: boolean;
  weekdaysAny: boolean;
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function cronValue(token: string, names: string[] | null, offset: number): number | null {
  if (/^\d{1,2}$/.test(token)) return Number(token);
  const index = names?.indexOf(token.toLowerCase()) ?? -1;
  return index === -1 ? null : index + offset;
}

/** One field as the set of values it names, or null when it is not a valid field. */
function cronField(field: string, min: number, max: number, names: string[] | null = null, offset = 0) {
  const values = new Set<number>();
  for (const part of field.split(",")) {
    const match = /^(\*|[a-z0-9]+(?:-[a-z0-9]+)?)(?:\/(\d{1,2}))?$/i.exec(part);
    if (!match) return null;
    const [, range, stepText] = match;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) return null;
    let low: number | null;
    let high: number | null;
    if (range === "*") {
      [low, high] = [min, max];
    } else if (range.includes("-")) {
      const [a, b] = range.split("-");
      [low, high] = [cronValue(a, names, offset), cronValue(b, names, offset)];
    } else {
      low = cronValue(range, names, offset);
      high = stepText === undefined ? low : max;
    }
    if (low === null || high === null || low < min || high > max || low > high) return null;
    for (let value = low; value <= high; value += step) values.add(value);
  }
  return values;
}

/**
 * A standard five-field cron expression (`*`, lists, ranges, steps, and English month and day
 * names), or null. Day-of-week 0 and 7 are both Sunday. As in every cron, when both day fields
 * are restricted a day matches either of them.
 */
export function parseCron(expression: string): CronFields | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const minutes = cronField(fields[0], 0, 59);
  const hours = cronField(fields[1], 0, 23);
  const monthDays = cronField(fields[2], 1, 31);
  const months = cronField(fields[3], 1, 12, MONTH_NAMES, 1);
  const weekdaysRaw = cronField(fields[4], 0, 7, DAY_NAMES, 0);
  if (!minutes || !hours || !monthDays || !months || !weekdaysRaw) return null;
  const weekdays = new Set([...weekdaysRaw].map((day) => (day === 7 ? 0 : day)));
  const monthDaysAny = fields[2].startsWith("*");
  const weekdaysAny = fields[4].startsWith("*");
  return {
    minutes,
    hours,
    monthDays,
    months,
    weekdays,
    monthDaysAny,
    weekdaysAny,
    eitherDay: !monthDaysAny && !weekdaysAny,
  };
}

/* Which minutes of a day a rule names */

function dayNumber(day: CivilDate): number {
  return Number(day.slice(8, 10));
}

function daysMatch(days: SyncDays, day: CivilDate): boolean {
  if (days.kind === "every") return true;
  if (days.kind === "weekdays") return days.weekdays.includes(dayOfWeek(day) || 7);
  const number = dayNumber(day);
  return days.monthDays.some(
    (wanted) => wanted === number || (wanted === LAST_DAY && lastDayOfMonth(monthKey(day)) === day),
  );
}

const cronCache = new Map<string, CronFields | null>();
function cronOf(expression: string): CronFields | null {
  if (!cronCache.has(expression)) cronCache.set(expression, parseCron(expression));
  return cronCache.get(expression) ?? null;
}

function cronDayMatches(cron: CronFields, day: CivilDate): boolean {
  if (!cron.months.has(Number(day.slice(5, 7)))) return false;
  const byMonthDay = cron.monthDays.has(dayNumber(day));
  const byWeekday = cron.weekdays.has(dayOfWeek(day));
  if (cron.eitherDay) return byMonthDay || byWeekday;
  return (cron.monthDaysAny || byMonthDay) && (cron.weekdaysAny || byWeekday);
}

/** The wall-clock minutes (0–1439) of one civil day at which a rule runs, ascending. */
export function ruleMinutesOn(rule: SyncRule, day: CivilDate): number[] {
  if (rule.kind === "cron") {
    const cron = cronOf(rule.expression);
    if (!cron || !cronDayMatches(cron, day)) return [];
    const minutes: number[] = [];
    for (const hour of [...cron.hours].sort((a, b) => a - b)) {
      for (const minute of [...cron.minutes].sort((a, b) => a - b)) minutes.push(hour * 60 + minute);
    }
    return minutes;
  }
  if (!daysMatch(rule.days, day)) return [];
  if (rule.kind === "times") return rule.times.map(minutesOf);
  const minutes: number[] = [];
  for (let minute = minutesOf(rule.from); minute <= minutesOf(rule.until); minute += rule.everyMinutes) {
    minutes.push(minute);
  }
  return minutes;
}

/** The wall-clock minutes of one civil day at which the schedule runs: every rule's, merged. */
export function scheduleMinutesOn(schedule: SyncSchedule, day: CivilDate): number[] {
  if (schedule.rules.length === 1) return ruleMinutesOn(schedule.rules[0], day);
  return sortedUnique(schedule.rules.flatMap((rule) => ruleMinutesOn(rule, day)));
}

/**
 * The next `count` instants strictly after `after` at which the schedule runs, in the person's
 * zone; empty for a manual schedule or one that never runs within {@link HORIZON_DAYS}. Times are
 * local wall-clock times: "07:00" stays 07:00 across a change of daylight saving time, a time the
 * clock skips runs as far after the jump as it was meant to, and a time the clock repeats runs
 * once (`wallClockIn`). The day before is looked at too, so no zone's offset hides an answer.
 */
export function nextSyncTimes(schedule: SyncSchedule, timeZone: string, after: Date, count: number): Date[] {
  if (schedule.rules.length === 0 || count <= 0) return [];
  const found: Date[] = [];
  const first = addDays(civilDateIn(after, timeZone), -1);
  for (let offset = 0; offset <= HORIZON_DAYS && found.length < count; offset += 1) {
    const day = addDays(first, offset);
    const instants = scheduleMinutesOn(schedule, day)
      .map((minutes) => wallClockIn(day, minutes, timeZone).getTime())
      .filter((instant) => instant > after.getTime())
      .sort((a, b) => a - b);
    for (const instant of instants) {
      const last = found.at(-1)?.getTime();
      if (last !== undefined && instant <= last) continue;
      found.push(new Date(instant));
      if (found.length === count) break;
    }
  }
  return found;
}

/** The first instant strictly after `after` at which the schedule runs; null if none. */
export function nextSyncAt(schedule: SyncSchedule, timeZone: string, after: Date): Date | null {
  return nextSyncTimes(schedule, timeZone, after, 1)[0] ?? null;
}

/**
 * The next pass after one the dispatcher has just made for the slot `due`: the first slot after
 * `now`, and never closer than {@link MIN_SYNC_GAP_MINUTES} to `due`. The second half guards what
 * validation cannot see — two slots the autumn change folds into one hour.
 */
export function nextSyncAfterPass(
  schedule: SyncSchedule,
  timeZone: string,
  due: Date | null,
  now: Date,
): Date | null {
  const floor = due ? due.getTime() + (MIN_SYNC_GAP_MINUTES - 1) * 60_000 : 0;
  return nextSyncAt(schedule, timeZone, new Date(Math.max(now.getTime(), floor)));
}

/* What is wrong with a schedule that parses */

export type ScheduleProblem =
  | { code: "tooFrequent"; day: CivilDate; first: string; second: string }
  | { code: "neverRuns"; rule: number };

/**
 * Whether a well-formed schedule is also one the app accepts: every rule runs at least once in
 * {@link HORIZON_DAYS} (a cron that names 31 February never does), and no two passes are closer
 * than {@link MIN_SYNC_GAP_MINUTES}, over all rules together and across midnight, checked on the
 * wall clock over {@link GAP_CHECK_DAYS} from `today`.
 */
export function scheduleProblems(schedule: SyncSchedule, today: CivilDate): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  schedule.rules.forEach((rule, index) => {
    for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
      if (ruleMinutesOn(rule, addDays(today, offset)).length > 0) return;
    }
    problems.push({ code: "neverRuns", rule: index });
  });
  let previous: { at: number; day: CivilDate; minutes: number } | null = null;
  for (let offset = 0; offset < GAP_CHECK_DAYS; offset += 1) {
    const day = addDays(today, offset);
    for (const minutes of scheduleMinutesOn(schedule, day)) {
      const at = offset * 24 * 60 + minutes;
      if (previous && at - previous.at < MIN_SYNC_GAP_MINUTES) {
        problems.push({
          code: "tooFrequent",
          day: previous.day,
          first: timeOf(previous.minutes),
          second: timeOf(minutes),
        });
        return problems;
      }
      previous = { at, day, minutes };
    }
  }
  return problems;
}
