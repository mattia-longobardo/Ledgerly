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
  LAST_DAY,
  MAX_RULES,
  MIN_SYNC_GAP_MINUTES,
  syncRuleSchema as wireRuleSchema,
} from "@ledgerly/api-contract";
import {
  addDays,
  type CivilDate,
  civilDateIn,
  dayOfWeek,
  lastDayOfMonth,
  monthKey,
  wallClockIn,
} from "../../shared/dates";

// The limits and the shape of a rule are the contract's (`@ledgerly/api-contract`, one source for
// the web, the apps and the domain); the domain adds what it computes from: sorted lists without
// repeats, a cron written with single spaces, and a cron whose fields name real values.
export {
  LAST_DAY,
  MAX_BANK_SYNCS_PER_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
} from "@ledgerly/api-contract";

/** How far ahead a schedule is looked at: a cron that names 29 February runs once in four years. */
const HORIZON_DAYS = 4 * 366 + 7;
/** How far ahead the gap between passes is checked: every weekday of every kind of month. */
const GAP_CHECK_DAYS = 400;

const sortedUnique = <T extends number | string>(values: T[]): T[] =>
  [...new Set(values)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

type WireRule = z.output<typeof wireRuleSchema>;
type WireDays = Extract<WireRule, { days: unknown }>["days"];

function normalisedDays(days: WireDays): WireDays {
  if (days.kind === "weekdays") return { ...days, weekdays: sortedUnique(days.weekdays) };
  if (days.kind === "monthDays") return { ...days, monthDays: sortedUnique(days.monthDays) };
  return days;
}

function normalisedRule(rule: WireRule): WireRule {
  if (rule.kind === "cron") return { ...rule, expression: rule.expression.split(/\s+/).join(" ") };
  if (rule.kind === "times")
    return { ...rule, times: sortedUnique(rule.times), days: normalisedDays(rule.days) };
  return { ...rule, days: normalisedDays(rule.days) };
}

export const syncRuleSchema = wireRuleSchema
  .transform(normalisedRule)
  .refine((rule) => rule.kind !== "cron" || parseCron(rule.expression) !== null);
export type SyncRule = z.output<typeof syncRuleSchema>;
export type RuleKind = SyncRule["kind"];
export type SyncDays = Extract<SyncRule, { days: unknown }>["days"];

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

function timeOf(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/* A five-field cron expression: minute hour day-of-month month day-of-week */

interface CronFields {
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

function dayOfMonth(day: CivilDate): number {
  return Number(day.slice(8, 10));
}

function daysMatch(days: SyncDays, day: CivilDate): boolean {
  if (days.kind === "every") return true;
  if (days.kind === "weekdays") return days.weekdays.includes(dayOfWeek(day) || 7);
  const number = dayOfMonth(day);
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
  const byMonthDay = cron.monthDays.has(dayOfMonth(day));
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
function scheduleMinutesOn(schedule: SyncSchedule, day: CivilDate): number[] {
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
  | { code: "tooMany"; day: CivilDate; count: number; max: number }
  | { code: "neverRuns"; rule: number };

/**
 * Whether a well-formed schedule is also one the app accepts: every rule runs at least once in
 * {@link HORIZON_DAYS} (a cron that names 31 February never does), and no two passes are closer
 * than {@link MIN_SYNC_GAP_MINUTES}, over all rules together and across midnight, checked on the
 * wall clock over {@link GAP_CHECK_DAYS} from `today`. With `maxPerDay` (a bank's connection), no
 * day of {@link HORIZON_DAYS} from `today` has more passes than that, over all rules together.
 */
export function scheduleProblems(
  schedule: SyncSchedule,
  today: CivilDate,
  maxPerDay?: number,
): ScheduleProblem[] {
  const problems: ScheduleProblem[] = [];
  schedule.rules.forEach((rule, index) => {
    for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
      if (ruleMinutesOn(rule, addDays(today, offset)).length > 0) return;
    }
    problems.push({ code: "neverRuns", rule: index });
  });
  if (maxPerDay !== undefined) {
    const crowded = crowdedDay(schedule, today, maxPerDay);
    if (crowded) problems.push({ code: "tooMany", ...crowded, max: maxPerDay });
  }
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

/** The first day from `today` with more than `max` passes, and how many; null when there is none. */
function crowdedDay(
  schedule: SyncSchedule,
  today: CivilDate,
  max: number,
): { day: CivilDate; count: number } | null {
  if (schedule.rules.length === 0) return null;
  for (let offset = 0; offset <= HORIZON_DAYS; offset += 1) {
    const day = addDays(today, offset);
    const count = scheduleMinutesOn(schedule, day).length;
    if (count > max) return { day, count };
  }
  return null;
}

/** What the preview of a schedule can say: its problems, or a rule the server does not accept. */
export type PreviewProblem = ScheduleProblem | { code: "invalidRule"; rule: number };

/**
 * The preview of a schedule not saved yet (`POST /connections/{id}/schedule/preview`): the rules
 * the server refuses, else the problems of the whole, else the next `count` passes after `now`.
 * The same answer the editor computed in the browser before R3: a client now asks for it.
 * `maxPerDay`: the most passes a day allows, for a bank's connection (`tooMany`).
 */
export function previewSchedule(
  rules: readonly unknown[],
  timeZone: string,
  now: Date,
  { count, maxPerDay }: { count: number; maxPerDay?: number },
): { next: Date[]; problems: PreviewProblem[] } {
  const invalid = rules.flatMap((rule, index) =>
    syncRuleSchema.safeParse(rule).success ? [] : [{ code: "invalidRule" as const, rule: index }],
  );
  if (invalid.length > 0) return { next: [], problems: invalid };
  const schedule = syncScheduleSchema.parse({ rules });
  const problems = scheduleProblems(schedule, civilDateIn(now, timeZone), maxPerDay);
  return { next: problems.length > 0 ? [] : nextSyncTimes(schedule, timeZone, now, count), problems };
}
