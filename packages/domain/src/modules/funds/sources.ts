// The contribution sources of a fund (rewrite plan, 11-standardization.md §11.2.1, extension point E2).
// Pure. A source describes the plan — where the money comes from and when it is due —, and never the
// paid-in amount: that always comes from the operations recorded in the fund.
import {
  addDays,
  addMonths,
  type CivilDate,
  daysBetween,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
} from "../../platform/dates";

export const SOURCE_KINDS = ["payroll", "bank_debit", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATES = ["active", "paused"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

/** What a payslip can pay into a fund. The employer's part is a component, not a source (ST-1). */
export const PAYROLL_COMPONENTS = ["worker", "employer", "tfr"] as const;
export type PayrollComponent = (typeof PAYROLL_COMPONENTS)[number];

/** The span a payslip's money is transferred for: each month, or the three months of a quarter. */
export const ACCRUAL_PERIODS = ["month", "quarter"] as const;
export type AccrualPeriod = (typeof ACCRUAL_PERIODS)[number];

/**
 * "Every N weeks, months or years": the one frequency of the app. Subscriptions take the same shape
 * in R5a, so a second primitive is not written there.
 */
export const INTERVAL_UNITS = ["week", "month", "year"] as const;
export type IntervalUnit = (typeof INTERVAL_UNITS)[number];

export interface Frequency {
  count: number;
  unit: IntervalUnit;
}

export const MONTHLY: Frequency = { count: 1, unit: "month" };

export function isFrequency(value: { count: number; unit: string }): value is Frequency {
  return (
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    value.count <= 120 &&
    INTERVAL_UNITS.includes(value.unit as IntervalUnit)
  );
}

// ——— The accrual periods of a payroll source ——————————————————————————————————————————————————

/** How many months one period holds. */
export const monthsPerPeriod = (period: AccrualPeriod): 1 | 3 => (period === "month" ? 1 : 3);

/** The periods of a year: 12 months or 4 quarters. */
export const periodsPerYear = (period: AccrualPeriod): 12 | 4 => (period === "month" ? 12 : 4);

/** The period a month falls in, counted from 1 within its year. */
export function periodIndexOf(month: MonthKey | CivilDate, period: AccrualPeriod): number {
  const number = Number(month.slice(5, 7));
  return period === "month" ? number : Math.floor((number - 1) / 3) + 1;
}

/** The first month of a period. */
export function periodStart(year: number, index: number, period: AccrualPeriod): MonthKey {
  return addMonths(monthKey(`${year}-01-01`), (index - 1) * monthsPerPeriod(period));
}

/** The last day of a period. */
export function periodEnd(year: number, index: number, period: AccrualPeriod): CivilDate {
  return lastDayOfMonth(addMonths(periodStart(year, index, period), monthsPerPeriod(period) - 1));
}

/**
 * The period a payslip's contribution belongs to under a source. The payslip states a quarter, which
 * is what a quarterly source reads; a monthly source reads the payslip's month, and puts a payslip
 * with no month of its own (a thirteenth) in the last month of the quarter the payslip states.
 */
export function competencePeriod(
  line: { payrollPeriod: string | null; quarter: number },
  period: AccrualPeriod,
): number {
  if (period === "quarter") return line.quarter;
  return line.payrollPeriod === null ? line.quarter * 3 : Number(line.payrollPeriod.slice(5, 7));
}

/**
 * When a period's transfer is due, as the three fields of a source say it: on `day` of the month
 * that comes `offsetMonths` after the period's last month. `0` is the last month itself. The day is
 * held back to the month's length.
 */
export interface DueRule {
  day: number;
  offsetMonths: number;
}

/** One explicit due date of a year: a schedule the three fields cannot say. Kept as it was stored. */
export interface DueEntry {
  /** The period within its year, from 1. */
  period: number;
  month: number;
  day: number;
  nextYear: boolean;
}

export interface DueCalendar {
  rule: DueRule | null;
  /** Explicit dates; they win over the rule for the periods they name. */
  entries: readonly DueEntry[];
}

export const NO_CALENDAR: DueCalendar = { rule: null, entries: [] };

export const hasDueDates = (calendar: DueCalendar): boolean =>
  calendar.rule !== null || calendar.entries.length > 0;

const civil = (year: number, month: number, day: number): CivilDate =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** The due date of one period; `null` when the source has no due dates, or none for this period. */
export function dueOn(
  year: number,
  index: number,
  period: AccrualPeriod,
  calendar: DueCalendar,
): CivilDate | null {
  const entry = calendar.entries.find((one) => one.period === index);
  if (entry) return civil(year + (entry.nextYear ? 1 : 0), entry.month, entry.day);
  if (calendar.rule === null || calendar.entries.length > 0) return null;
  const month = addMonths(monthKey(periodEnd(year, index, period)), calendar.rule.offsetMonths);
  const last = Number(lastDayOfMonth(month).slice(8));
  return `${month.slice(0, 8)}${String(Math.min(calendar.rule.day, last)).padStart(2, "0")}`;
}

/** The explicit dates of a stored schedule: only well-formed entries, one per period. */
export function parseDueEntries(value: unknown, period: AccrualPeriod): DueEntry[] {
  if (!Array.isArray(value)) return [];
  const out: DueEntry[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const fields = raw as Record<string, unknown>;
    // A schedule written before the sources named its period `quarter`.
    const index = typeof fields.period === "number" ? fields.period : fields.quarter;
    const { month, day, nextYear } = fields;
    if (
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= 1 &&
      index <= periodsPerYear(period) &&
      typeof month === "number" &&
      Number.isInteger(month) &&
      month >= 1 &&
      month <= 12 &&
      typeof day === "number" &&
      Number.isInteger(day) &&
      day >= 1 &&
      day <= 28 &&
      typeof nextYear === "boolean" &&
      !out.some((one) => one.period === index)
    ) {
      out.push({ period: index, month, day, nextYear });
    }
  }
  return out.sort((a, b) => a.period - b.period);
}

/**
 * The rule that says the same dates as a set of explicit entries, when there is one: every period
 * due on the same day, the same number of months after its end. `null` otherwise: the entries stay.
 */
export function ruleOfEntries(entries: readonly DueEntry[], period: AccrualPeriod): DueRule | null {
  if (entries.length !== periodsPerYear(period)) return null;
  let found: DueRule | null = null;
  for (const entry of entries) {
    const lastMonth = entry.period * monthsPerPeriod(period);
    const offsetMonths = entry.month + (entry.nextYear ? 12 : 0) - lastMonth;
    if (offsetMonths < 0 || offsetMonths > 3) return null;
    if (found !== null && (found.day !== entry.day || found.offsetMonths !== offsetMonths)) return null;
    found = { day: entry.day, offsetMonths };
  }
  return found;
}

/** The next due dates after `todayOn`, oldest first: what the form shows under the three fields. */
export function nextDueDates(
  period: AccrualPeriod,
  calendar: DueCalendar,
  todayOn: CivilDate,
  count = 4,
): CivilDate[] {
  if (!hasDueDates(calendar)) return [];
  const dates: CivilDate[] = [];
  const firstYear = Number(todayOn.slice(0, 4)) - 1;
  for (let year = firstYear; year <= firstYear + 3 && dates.length < count; year += 1) {
    for (let index = 1; index <= periodsPerYear(period) && dates.length < count; index += 1) {
      const due = dueOn(year, index, period, calendar);
      if (due !== null && due >= todayOn) dates.push(due);
    }
  }
  return dates.sort().slice(0, count);
}

// ——— The periods of a recurring debit ——————————————————————————————————————————————————————————

/** Days after the expected day before a missing debit is worth saying. */
export const DEBIT_GRACE_DAYS = 3;

export interface DebitPlan {
  frequency: Frequency;
  /** The day of the month the debit is expected on; `null` when the plan does not say. */
  day: number | null;
  /** The first day of the plan: the periods are counted from it. */
  startOn: CivilDate;
  /** The last day of the plan; `null` while it has no end. */
  endOn: CivilDate | null;
}

export interface DebitPeriod {
  /** First and last day of the period, both included. */
  from: CivilDate;
  to: CivilDate;
  /** The day the debit is expected on, inside the period; `null` when the plan gives no day. */
  expectedOn: CivilDate | null;
}

const clampDay = (month: MonthKey, day: number): CivilDate => {
  const last = Number(lastDayOfMonth(month).slice(8));
  return `${month.slice(0, 8)}${String(Math.min(day, last)).padStart(2, "0")}`;
};

/**
 * The period of a plan that holds `on`: the plan's time cut every N weeks, months or years from its
 * start. Months and years are calendar ones — "every month" is each calendar month, "every 3 months"
 * the three calendar months from the month of the start — and weeks run from the start day itself.
 * `null` before the start and after the end.
 */
export function debitPeriodOf(plan: DebitPlan, on: CivilDate): DebitPeriod | null {
  if (on < plan.startOn || (plan.endOn !== null && on > plan.endOn)) return null;
  const { count, unit } = plan.frequency;
  if (unit === "week") {
    const length = count * 7;
    const from = addDays(plan.startOn, Math.floor(daysBetween(plan.startOn, on) / length) * length);
    return { from, to: addDays(from, length - 1), expectedOn: from };
  }
  const months = unit === "month" ? count : count * 12;
  const start = monthKey(plan.startOn);
  const passed =
    (Number(on.slice(0, 4)) - Number(start.slice(0, 4))) * 12 +
    (Number(on.slice(5, 7)) - Number(start.slice(5, 7)));
  const first = addMonths(start, Math.floor(passed / months) * months);
  return {
    from: first,
    to: lastDayOfMonth(addMonths(first, months - 1)),
    expectedOn: plan.day === null ? null : clampDay(first, plan.day),
  };
}

/** The state of the running period of a recurring debit: found, still awaited, or missing. */
export type DebitStatus =
  | { kind: "found"; on: CivilDate }
  | { kind: "awaited" }
  | { kind: "missing"; by: CivilDate }
  | { kind: "none" };

/**
 * Whether the debit of the running period arrived. Found when a contribution is dated inside the
 * period; missing once the expected day and {@link DEBIT_GRACE_DAYS} days have passed with none;
 * awaited before that. A plan with no day or no amount expects nothing on a given day, so it only
 * ever says "found".
 */
export function debitStatus(input: {
  plan: DebitPlan;
  /** False for a paused source or an archived fund: nothing is expected. */
  active: boolean;
  /** False when the plan has no expected amount. */
  expectsAmount: boolean;
  /** The days of the fund's voluntary contributions. */
  contributions: readonly CivilDate[];
  todayOn: CivilDate;
}): DebitStatus {
  const { plan, todayOn } = input;
  const period = debitPeriodOf(plan, todayOn);
  if (period !== null) {
    const found = input.contributions.filter((on) => on >= period.from && on <= period.to).sort();
    if (found.length > 0) return { kind: "found", on: found[found.length - 1] };
  }
  if (!input.active || !input.expectsAmount || period === null || period.expectedOn === null) {
    return { kind: "none" };
  }
  const by = addDays(period.expectedOn, DEBIT_GRACE_DAYS);
  return todayOn > by ? { kind: "missing", by } : { kind: "awaited" };
}

/** What a plan puts in each month, for the projection: the expected amount brought to a month. */
export function monthlyOf(amountCents: bigint, frequency: Frequency): bigint {
  if (frequency.unit === "month") return amountCents / BigInt(frequency.count);
  if (frequency.unit === "year") return amountCents / BigInt(frequency.count * 12);
  // 52 weeks a year, 12 months a year.
  return (amountCents * 52n) / BigInt(frequency.count * 12);
}
