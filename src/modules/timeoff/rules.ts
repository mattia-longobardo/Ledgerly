/**
 * The vocabulary of time off, and every rule about it that needs no database (spec §7.9).
 *
 * One unit for booking, two for counting. A day off is half a day or a whole one, whatever its
 * kind (N0: ROL used to be free-form minutes, and nobody books leave by the minute). The totals
 * are held in **minutes** because a payslip states ROL in hours and an allowance in days, and
 * minutes are the finer of the two — converting down loses nothing, converting up rounds. The
 * bridge is `minutes_per_day` from the user's preferences; there is no "8 hours" written here.
 */
import { z } from "zod";
import {
  type CivilDate,
  type MonthKey,
  addDays,
  dayOfWeek,
  isCivilDate,
  lastDayOfMonth,
  monthKey,
} from "@/platform/dates";
import { isWeekend } from "@/platform/holidays/rules";

/** What a day off can be. */
export const LEAVE_DAY_KINDS = ["vacation", "rol", "comp", "sick", "other"] as const;
export type LeaveDayKind = (typeof LEAVE_DAY_KINDS)[number];

/** The kinds Trek's own rows can be in, and therefore the only ones a toggle may ever name. */
export const TREK_KINDS = ["vacation", "comp"] as const;
export type TrekKind = (typeof TREK_KINDS)[number];

/**
 * The kinds that reach Trek at all — the leave that spends the year's allowance.
 *
 * ROL is among them since N4 even though Trek has no such thing: it goes across as `vacation`,
 * which is the owner's own instruction and the only honest option, since a day that is not on
 * Trek reads to a colleague as a day at work. Sickness and "other" stay here: they are absences
 * of a different kind, not leave anybody books.
 */
export const KINDS_FOR_TREK = ["vacation", "rol", "comp"] as const;

export function goesToTrek(kind: LeaveDayKind): boolean {
  return (KINDS_FOR_TREK as readonly string[]).includes(kind);
}

/**
 * What a kind becomes on Trek: everything that goes there goes as a holiday (N4).
 *
 * The argument is taken and ignored on purpose — the call site reads as a mapping, and the day
 * the answer stops being the same for every kind this is the one place that has to change.
 */
export function asTrekKind(kind: LeaveDayKind): TrekKind {
  void kind;
  return "vacation";
}

/**
 * Where a row came from. There is no `payroll`: leave read off a payslip is monthly (hours per
 * usage month), not daily, and inventing a date for it would make up a fact the payslip does not
 * state (plan F7 §3.6.1). Those appear in the table as month rows, read-only, from their own read.
 */
export const LEAVE_ORIGINS = ["manual", "trek"] as const;
export type LeaveOrigin = (typeof LEAVE_ORIGINS)[number];

/** What the next Trek pass owes this row. `none` means the two agendas agree. */
export const PENDING_STATES = ["none", "upsert", "delete"] as const;
export type PendingState = (typeof PENDING_STATES)[number];

/** The only two sizes a day off comes in. */
export const DAY_FRACTIONS = [0.5, 1] as const;

/** A day is `taken` once a payslip has counted it, `planned` until then (N2). */
export type DayStatus = "taken" | "planned";

/* Conversions (plan F7 §3.4.4) */

/** Minutes as a number of days, rounded to a half day — the only granularity a day row has. */
export function minutesToDays(minutes: number, minutesPerDay: number): number {
  if (minutesPerDay <= 0) throw new RangeError("minutesPerDay must be positive");
  return Math.round((minutes / minutesPerDay) * 2) / 2;
}

/** Days as minutes, rounded to the minute: what a half day is worth on this user's schedule. */
export function daysToMinutes(days: number, minutesPerDay: number): number {
  if (minutesPerDay <= 0) throw new RangeError("minutesPerDay must be positive");
  return Math.round(days * minutesPerDay);
}

/* Bookability (spec §7.9) */

export type Bookable = { ok: true } | { ok: false; reason: "weekend" | "holiday" };

/**
 * Whether a leave day may be booked on a date: not a weekend, and not one of this person's public
 * holidays. The refusal carries its reason because the form shows it on the date field, not as a
 * generic error.
 *
 * The holidays arrive as a set of dates rather than a country and a town: which calendars a person
 * keeps is their own business (M3), and by the time a rule is deciding about one date the answer
 * is simply "is it in there".
 */
export function bookable(date: CivilDate, holidays: ReadonlySet<CivilDate>): Bookable {
  if (isWeekend(date)) return { ok: false, reason: "weekend" };
  if (holidays.has(date)) return { ok: false, reason: "holiday" };
  return { ok: true };
}

/**
 * Whether a day counts as taken (N2).
 *
 * Not the calendar's opinion but the payslip's: a day is **taken** once the employer has counted
 * it, which is to say once a payslip has arrived covering the month it was used in. Everything
 * else is **planned** — the future, and the days of a month whose payslip has not come yet.
 *
 * It used to be "past is taken, future is planned", which was simpler and said the wrong thing:
 * the leave you took last week is not yet leave anybody has counted, and the residual the payslip
 * prints does not know about it. With no payslips at all, `countedThrough` is `null` and nothing
 * is taken — which is exactly right for somebody whose employer's numbers this app has never seen.
 *
 * `countedThrough` is a month ("YYYY-MM-01"): the last month of use an applied payslip accounts for.
 */
export function dayStatus(date: CivilDate, countedThrough: MonthKey | null): DayStatus {
  if (countedThrough === null) return "planned";
  return date.slice(0, 7) <= countedThrough.slice(0, 7) ? "taken" : "planned";
}

/* The shape of a day, as the pure rules see it */

export interface LeaveDayView {
  on: CivilDate;
  kind: LeaveDayKind;
  /** Half a day or a whole one — the only two a day off comes in, every kind alike (N0). */
  fraction: number;
}

/** What one day is worth in days. */
export function dayWeight(day: LeaveDayView): number {
  return day.fraction;
}

/** What one day is worth in minutes, on this person's working day. */
export function minuteWeight(day: LeaveDayView, minutesPerDay: number): number {
  return daysToMinutes(day.fraction, minutesPerDay);
}

/* The residual, and where it comes from (spec §7.9, the binding rule) */

/** Which of the two formulas produced a residual — the interface always says which. */
export type ResidualBasis = "payslip" | "allowance" | "unknown";

export interface ResidualSnapshot {
  /** The month of the payslip that printed it. */
  period: MonthKey;
  /** What the payslip printed as RES., in hours. */
  remainingHours: number;
}

export interface ResidualInput {
  /** The last applied payslip's snapshot for this kind, when there is one. */
  snapshot: ResidualSnapshot | null;
  /**
   * The year's allowance, in minutes, and what the years before it left over, likewise.
   *
   * The carry-over is the payslip's own A.P. since N9, not something anybody types: it is counted
   * for every kind (N1), and it is added only on the `allowance` basis — a printed RES. already
   * has it inside (A.P. + MAT. − GOD. = RES.).
   */
  allowanceMinutes: number | null;
  carriedMinutes: number;
  /** Every local day of this kind in the year. */
  days: readonly LeaveDayView[];
  /** The last month of use an applied payslip accounts for; `null` when there is none. */
  countedThrough: MonthKey | null;
  minutesPerDay: number;
}

/**
 * A residual, always in **minutes** (plan F7 §3.4.4).
 *
 * Minutes and not days, because days are the coarser of the two units: a ROL balance of 3½ hours
 * rounded to the nearest half day and converted back comes out as 4, and the card would print a
 * number the payslip never said. The caller divides by the day length for the kinds counted in
 * days — which is exact, since those are stored as whole or half days in the first place.
 */
export interface ResidualView {
  basis: ResidualBasis;
  /** `null` when neither formula applies: the interface shows "—" and the reason. */
  remainingMinutes: number | null;
  takenMinutes: number;
  plannedMinutes: number;
  /**
   * For `payslip`: the month whose payslip printed the residual, and the last month of use it
   * accounts for (its own month minus one). `null` otherwise.
   */
  snapshotPeriod: MonthKey | null;
  countedThrough: MonthKey | null;
}

/**
 * The residual of one kind, in minutes, and the provenance of the number (spec §7.9).
 *
 * Two formulas, never mixed:
 *  - with a payslip snapshot, the payslip's RES. is the truth up to the month it accounts for, and
 *    only the **planned** days are subtracted — which since N2 means exactly the days that month
 *    does not cover. Subtracting days the payslip already counted would count them twice, and so
 *    would adding the carry-over, which is already inside the printed RES.;
 *  - without one, the plain `allowance + carried − taken − planned`, carry-over included (N1).
 *
 * With neither a snapshot nor an allowance the answer is `null`, not zero: "we do not know" and
 * "nothing left" are different things, and the card says which one it is showing.
 */
export function residual(input: ResidualInput): ResidualView {
  const { snapshot, allowanceMinutes, carriedMinutes, days, countedThrough, minutesPerDay } = input;

  const weigh = (subset: readonly LeaveDayView[]): number =>
    subset.reduce((sum, day) => sum + minuteWeight(day, minutesPerDay), 0);
  const taken = days.filter((day) => dayStatus(day.on, countedThrough) === "taken");
  const planned = days.filter((day) => dayStatus(day.on, countedThrough) === "planned");
  const takenMinutes = weigh(taken);
  const plannedMinutes = weigh(planned);

  if (snapshot) {
    // The payslip's RES. already has the previous years inside it (A.P. + MAT. − GOD. = RES.), so
    // the carry-over is **not** added here — it would be counted twice.
    return {
      basis: "payslip",
      remainingMinutes: Math.round(snapshot.remainingHours * 60) - plannedMinutes,
      takenMinutes,
      plannedMinutes,
      snapshotPeriod: snapshot.period,
      countedThrough,
    };
  }

  if (allowanceMinutes === null) {
    return {
      basis: "unknown",
      remainingMinutes: null,
      takenMinutes,
      plannedMinutes,
      snapshotPeriod: null,
      countedThrough,
    };
  }

  return {
    basis: "allowance",
    remainingMinutes: allowanceMinutes + carriedMinutes - takenMinutes - plannedMinutes,
    takenMinutes,
    plannedMinutes,
    snapshotPeriod: null,
    countedThrough,
  };
}

/* The "By month" bars of the design */

export interface MonthBar {
  /** 1–12. */
  month: number;
  /** Minutes, like every other total here; the chart divides for its labels. */
  takenMinutes: number;
  plannedMinutes: number;
}

/**
 * Twelve bars, one per month, always all twelve: a month with nothing in it is a gap in the chart,
 * not a missing bar. Taken and planned are kept apart because the design stacks them.
 */
export function monthBars(
  days: readonly LeaveDayView[],
  year: number,
  minutesPerDay: number,
  countedThrough: MonthKey | null,
): MonthBar[] {
  const bars: MonthBar[] = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    takenMinutes: 0,
    plannedMinutes: 0,
  }));
  for (const day of days) {
    if (Number(day.on.slice(0, 4)) !== year) continue;
    const bar = bars[Number(day.on.slice(5, 7)) - 1];
    const weight = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough) === "taken") bar.takenMinutes += weight;
    else bar.plannedMinutes += weight;
  }
  return bars;
}

/* The twelve calendar grids of the design */

export interface CalendarCell {
  date: CivilDate | null;
  /** Empty for a day with nothing on it, and for the blanks that pad a month to whole weeks. */
  kinds: LeaveDayKind[];
  status: DayStatus | null;
  weekend: boolean;
  holiday: boolean;
  /** Less than a whole day off: the cell is drawn half-filled rather than merely paler. */
  partial: boolean;
}

export interface CalendarMonth {
  month: number;
  /** Whole weeks, padded with `date: null` at both ends. */
  weeks: CalendarCell[][];
}

/**
 * The year as twelve grids of whole weeks. `weekStart` is the user's (0 Sunday … 6 Saturday), so
 * an Italian calendar starts on Monday and the same code draws both.
 *
 * A cell can carry more than one kind — half a day of vacation and half of ROL is a real day — so
 * `kinds` is a list, in the order `LEAVE_DAY_KINDS` declares, and the legend colours them in that
 * same order.
 */
export function calendar(
  year: number,
  days: readonly LeaveDayView[],
  holidays: ReadonlySet<CivilDate>,
  weekStart: number,
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): CalendarMonth[] {
  const byDate = new Map<CivilDate, LeaveDayKind[]>();
  const weightByDate = new Map<CivilDate, number>();
  for (const day of days) {
    if (Number(day.on.slice(0, 4)) !== year) continue;
    const kinds = byDate.get(day.on) ?? [];
    kinds.push(day.kind);
    byDate.set(day.on, kinds);
    weightByDate.set(day.on, (weightByDate.get(day.on) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  const months: CalendarMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const first = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
    const lead = (dayOfWeek(first) - weekStart + 7) % 7;
    const cells: CalendarCell[] = Array.from({ length: lead }, () => blank());
    for (let date = first; Number(date.slice(5, 7)) === month; date = addDays(date, 1)) {
      const kinds = (byDate.get(date) ?? []).slice().sort(byDeclaredOrder);
      cells.push({
        date,
        kinds,
        status: kinds.length === 0 ? null : dayStatus(date, countedThrough),
        weekend: isWeekend(date),
        holiday: holidays.has(date),
        partial: kinds.length > 0 && (weightByDate.get(date) ?? 0) < minutesPerDay,
      });
    }
    while (cells.length % 7 !== 0) cells.push(blank());
    const weeks: CalendarCell[][] = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    months.push({ month, weeks });
  }
  return months;
}

function blank(): CalendarCell {
  return { date: null, kinds: [], status: null, weekend: false, holiday: false, partial: false };
}

function byDeclaredOrder(a: LeaveDayKind, b: LeaveDayKind): number {
  return LEAVE_DAY_KINDS.indexOf(a) - LEAVE_DAY_KINDS.indexOf(b);
}

/* What a caller may state */

const civilDate = z.string().refine(isCivilDate, "not a civil date");
const MAX_NOTE = 200;

/**
 * An allowance for one year, as the modal states it: only what an employer grants.
 *
 * What last year left over is **not** here any more (N9). It was asked for twice — once of the
 * person and once of the payslip, which prints it as A.P. — and the two could disagree with no way
 * to tell which was right. The payslip is the employer's own figure, so the payslip keeps it.
 *
 * ROL is stated in days like everything else since N9. A contract usually says hours, but the
 * whole screen counts in days, and a field in a unit nothing else uses is a field people convert
 * in their head and get wrong.
 */
export const allowanceInputSchema = z.object({
  vacationDays: z.number().min(0).max(400).nullable().default(null),
  rolDays: z.number().min(0).max(400).nullable().default(null),
  /** Vacation and ROL together, as the contract states it (N7); `null` when nobody has. */
  totalDays: z.number().min(0).max(400).nullable().default(null),
  note: z.string().trim().max(MAX_NOTE).nullish().default(null),
});
export type AllowanceInput = z.input<typeof allowanceInputSchema>;

/**
 * Whether the two parts of an allowance add up to the total the contract states (N7).
 *
 * `null` when there is nothing to compare — no total stated, or a part missing. Otherwise the
 * difference in days, positive when the parts come to more than the total. The screen reports it
 * rather than correcting either figure: both are things a person typed off a contract, and which
 * one is wrong is not the app's to decide.
 */
export function allowanceMismatchDays(input: {
  totalDays: number | null;
  vacationDays: number | null;
  rolDays: number | null;
}): number | null {
  const { totalDays, vacationDays, rolDays } = input;
  if (totalDays === null || vacationDays === null || rolDays === null) return null;
  const difference = vacationDays + rolDays - totalDays;
  // A tenth of a day is rounding between two units, not a disagreement worth a sentence.
  return Math.abs(difference) < 0.1 ? null : difference;
}

/**
 * A day off, or a run of them: `to` left out means the single day `from`. One unit for every kind
 * since N0 — half a day or a whole one — so there is no longer a pair of fields to state
 * inconsistently.
 */
export const leaveInputSchema = z
  .object({
    from: civilDate,
    to: civilDate.nullish().default(null),
    kind: z.enum(LEAVE_DAY_KINDS),
    fraction: z.number().nullish().default(null),
    note: z.string().trim().max(MAX_NOTE).nullish().default(null),
  })
  .refine((input) => input.to === null || input.to === undefined || input.to >= input.from, {
    path: ["to"],
    message: "range ends before it begins",
  })
  .refine((input) => (DAY_FRACTIONS as readonly number[]).includes(input.fraction ?? 1), {
    path: ["fraction"],
    message: "a day off is half a day or a whole one",
  });
export type LeaveInput = z.input<typeof leaveInputSchema>;

/** Every civil date of a closed range, ends included. */
export function datesBetween(from: CivilDate, to: CivilDate): CivilDate[] {
  const dates: CivilDate[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/* Leave the payslips know about and the calendar does not (M2) */

/** A month where the payslip counted more leave than the days recorded here add up to. */
export interface UnrecordedLeave {
  /** The month the hours were used in. */
  month: MonthKey;
  /** The kind as this module names it: a payroll `permit` is our ROL. */
  kind: Extract<LeaveDayKind, "vacation" | "rol">;
  payrollMinutes: number;
  recordedMinutes: number;
  missingMinutes: number;
}

/** A payslip's leave event, as `payroll` reports it. */
export interface PayrollLeave {
  kind: "vacation" | "rol" | "permit";
  hours: number;
  usagePeriod: MonthKey;
}

/** Rounding in two different units meets somewhere: a minute of daylight between them is not news. */
const UNRECORDED_TOLERANCE_MINUTES = 1;

/**
 * The months where a payslip says more leave was used than this calendar accounts for (M2).
 *
 * The payslip is the employer's own count and arrives a month late; a day taken and never written
 * down here shows up as the difference. Only that direction is reported: more recorded than the
 * payslip counted is the ordinary state of a month whose payslip has not come yet, and warning
 * about it would cry wolf every month.
 *
 * A `permit` from the payroll module counts against ROL — that is the kind it is confirmed as
 * (F5) — so the two are compared as one.
 */
export function unrecordedLeave(
  events: readonly PayrollLeave[],
  days: readonly LeaveDayView[],
  minutesPerDay: number,
): UnrecordedLeave[] {
  const key = (month: MonthKey, kind: string) => `${month}\u0000${kind}`;

  const payroll = new Map<string, number>();
  for (const event of events) {
    const kind = event.kind === "vacation" ? "vacation" : "rol";
    const at = key(event.usagePeriod, kind);
    payroll.set(at, (payroll.get(at) ?? 0) + Math.round(event.hours * 60));
  }

  const recorded = new Map<string, number>();
  for (const day of days) {
    if (day.kind !== "vacation" && day.kind !== "rol") continue;
    const at = key(monthKey(day.on), day.kind);
    recorded.set(at, (recorded.get(at) ?? 0) + minuteWeight(day, minutesPerDay));
  }

  const gaps: UnrecordedLeave[] = [];
  for (const [at, payrollMinutes] of payroll) {
    const [month, kind] = at.split("\u0000");
    const recordedMinutes = recorded.get(at) ?? 0;
    const missingMinutes = payrollMinutes - recordedMinutes;
    if (missingMinutes <= UNRECORDED_TOLERANCE_MINUTES) continue;
    gaps.push({
      month,
      kind: kind as "vacation" | "rol",
      payrollMinutes,
      recordedMinutes,
      missingMinutes,
    });
  }
  return gaps.sort((a, b) =>
    a.month === b.month ? a.kind.localeCompare(b.kind) : a.month < b.month ? -1 : 1,
  );
}

/* What the year adds up to (N5) */

/** Every kind's share of a year, in minutes, split the way the cards split everything else. */
export interface YearTotals {
  takenMinutes: number;
  plannedMinutes: number;
  totalMinutes: number;
  /** Per kind, in the order `LEAVE_DAY_KINDS` declares, and only the kinds that have something. */
  byKind: Array<{ kind: LeaveDayKind; minutes: number }>;
}

/**
 * Every day off of the year, all kinds together (N5): what has been taken, what is planned, and
 * what the two come to.
 *
 * All kinds and not just the two that spend an allowance: the question this answers is "how much
 * was I away this year", and a week of sick leave is a week away. The breakdown keeps them apart
 * for anybody who wants the other question.
 */
export function yearTotals(
  days: readonly LeaveDayView[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): YearTotals {
  let takenMinutes = 0;
  let plannedMinutes = 0;
  const perKind = new Map<LeaveDayKind, number>();

  for (const day of days) {
    const minutes = minuteWeight(day, minutesPerDay);
    if (dayStatus(day.on, countedThrough) === "taken") takenMinutes += minutes;
    else plannedMinutes += minutes;
    perKind.set(day.kind, (perKind.get(day.kind) ?? 0) + minutes);
  }

  return {
    takenMinutes,
    plannedMinutes,
    totalMinutes: takenMinutes + plannedMinutes,
    byKind: LEAVE_DAY_KINDS.filter((kind) => (perKind.get(kind) ?? 0) > 0).map((kind) => ({
      kind,
      minutes: perKind.get(kind) as number,
    })),
  };
}

/* Going over what is left (N5b), and what will have accrued by then (N9) */

/** A kind whose booked days come to more than there was to spend. */
export interface Overdrawn {
  kind: Extract<LeaveDayKind, "vacation" | "rol">;
  /** How far past zero, in minutes: always positive. */
  byMinutes: number;
  /** Which number it went past — the payslip's residual, or the stated allowance. */
  basis: ResidualBasis;
  /** For `payslip`: the month whose payslip printed the figure it went past. */
  snapshotPeriod: MonthKey | null;
  /**
   * The planned day the booking first outran what had accrued by it (N9), when the accrual was
   * worked out. `null` when there was no rate to work it out with, and the plain year-end figure
   * is all the warning has to go on.
   */
  onDate: CivilDate | null;
}

/**
 * Every working day of a year, ascending: neither a weekend nor one of this person's holidays.
 *
 * This is the denominator of the accrual (N9) — a year grants its days over the days actually
 * worked — and it is also what a day off is counted against, so the two can never be counted over
 * different calendars.
 */
export function workingDaysOf(year: number, holidays: ReadonlySet<CivilDate>): CivilDate[] {
  const days: CivilDate[] = [];
  for (let date = `${year}-01-01`; date.startsWith(String(year)); date = addDays(date, 1)) {
    if (bookable(date, holidays).ok) days.push(date);
  }
  return days;
}

/**
 * What a year's leave is worth per working day (N9): the whole grant spread over the days worked.
 *
 * `0` when nobody has stated an allowance, which is the honest answer — with no grant there is no
 * rate, and a rate guessed from a payslip's balance would put a number of the app's own invention
 * under a warning about somebody's holidays.
 */
export function accrualPerWorkingDay(allowanceMinutes: number | null, workingDays: number): number {
  if (allowanceMinutes === null || workingDays <= 0) return 0;
  return allowanceMinutes / workingDays;
}

export interface OverdrawnInput {
  view: ResidualView;
  /** The year's allowance for this kind, in minutes: the numerator of the rate. */
  allowanceMinutes: number | null;
  /** The payslip's carry-over, in minutes — part of what is available before a day accrues. */
  carriedMinutes: number;
  /** Every working day of the year, ascending (`workingDaysOf`). */
  workingDays: readonly CivilDate[];
  /** The planned days of this kind; the ones the residual subtracted. */
  planned: readonly LeaveDayView[];
  minutesPerDay: number;
}

/**
 * Whether a kind has been booked past what was left — and, since N9, past what will have accrued
 * by the day it is booked on.
 *
 * The plain check is the one that decides **whether** to warn: a residual that is still positive
 * is not a problem, and a residual nobody can compute (`unknown`) cannot be exceeded. What N9
 * changes is the answer when the residual does go negative, because the plain figure asks the
 * wrong question of a day in the future.
 *
 * Leave accrues as the year is worked: every working day — including the ones spent on leave —
 * adds the year's grant divided by the year's working days. A payslip's RES. is the balance at the
 * month it was printed for, so a fortnight booked in August is not spent against February's
 * balance but against February's balance **plus** six months of accrual. Warning about it in
 * February was simply wrong, and wrong warnings are how a screen teaches people to ignore it.
 *
 * So the planned days are walked in date order, each against what has accrued by its own date, and
 * the warning reports the worst shortfall and the day it happened on. Where the accrual cannot be
 * worked out — nobody stated an allowance — the year-end figure stands, exactly as before.
 */
export function overdrawn(
  kind: Extract<LeaveDayKind, "vacation" | "rol">,
  input: OverdrawnInput,
): Overdrawn | null {
  const { view, allowanceMinutes, carriedMinutes, workingDays, planned, minutesPerDay } = input;
  if (view.remainingMinutes === null || view.remainingMinutes >= 0) return null;

  const flat: Overdrawn = {
    kind,
    byMinutes: -view.remainingMinutes,
    basis: view.basis,
    snapshotPeriod: view.snapshotPeriod,
    onDate: null,
  };

  const perWorkingDay = accrualPerWorkingDay(allowanceMinutes, workingDays.length);
  if (perWorkingDay === 0) return flat;

  /*
   * Where the walk starts, which differs by basis because the two figures mean different things:
   *
   *  - a payslip's RES. is already-accrued balance, so it opens the window as it stands and only
   *    the months **after** the one it was printed for add to it. Its own month's accrual is
   *    inside it already (MAT.), and counting that month twice is the one way this could hand out
   *    days nobody has;
   *  - a stated allowance is the whole year at once, so it cannot open the window — it *is* the
   *    thing being spread. What opens it is the carry-over, less whatever a payslip has counted.
   */
  const [openingMinutes, accrueAfter] =
    view.basis === "payslip"
      ? [view.remainingMinutes + view.plannedMinutes, lastDayOfMonth(view.snapshotPeriod as MonthKey)]
      : [carriedMinutes - view.takenMinutes, null];

  const accruing = accrueAfter === null ? workingDays : workingDays.filter((day) => day > accrueAfter);
  const inOrder = [...planned].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

  let consumed = 0;
  let accrued = 0;
  let cursor = 0;
  let worst: Overdrawn | null = null;

  for (const day of inOrder) {
    // The working days are ascending and so are the planned days, so the accrual only ever moves
    // forward: one pass over each, not a scan per day.
    while (cursor < accruing.length && accruing[cursor] <= day.on) {
      accrued += perWorkingDay;
      cursor += 1;
    }
    consumed += minuteWeight(day, minutesPerDay);
    const short = consumed - (openingMinutes + accrued);
    // A minute either way is the rate's own arithmetic, not somebody booking a day they lack.
    if (short > 1 && (worst === null || short > worst.byMinutes)) {
      worst = { ...flat, byMinutes: Math.round(short), onDate: day.on };
    }
  }

  return worst;
}

/* The year, month by month (N7) */

/** What one month of the leave table has to say for itself. */
export interface MonthGroup {
  month: MonthKey;
  /**
   * What the payslips counted for this month, in minutes per kind — the employer's own figure.
   * `null` when no payslip covers the month yet, which for a month still to come is the normal
   * state and not a gap.
   */
  payroll: { vacationMinutes: number; rolMinutes: number } | null;
  /** What this calendar holds for the month, whatever the payslips say. */
  recorded: { vacationMinutes: number; rolMinutes: number; otherMinutes: number };
  /** Of the recorded minutes, the ones no payslip has counted yet. */
  plannedMinutes: number;
  /** Whether the payslip counted more than is recorded — the gap M2 warns about. */
  missingMinutes: number;
  /** `true` once a payslip covers the month: what makes "planned" mean "not yet counted". */
  counted: boolean;
}

/**
 * The twelve months of a year as the leave table groups them (N7).
 *
 * All twelve, always: a month with nothing in it still says what the payslip expected, and for a
 * month still to come the interesting figure is what is planned. Each group carries both sides —
 * what the employer counted and what is written down here — because the whole point of putting
 * them on one line is that a person can see them disagree.
 */
export function monthGroups(
  year: number,
  days: readonly LeaveDayView[],
  events: readonly PayrollLeave[],
  countedThrough: MonthKey | null,
  minutesPerDay: number,
): MonthGroup[] {
  const groups: MonthGroup[] = Array.from({ length: 12 }, (_, index) => {
    const month = `${String(year).padStart(4, "0")}-${String(index + 1).padStart(2, "0")}-01`;
    return {
      month,
      payroll: null,
      recorded: { vacationMinutes: 0, rolMinutes: 0, otherMinutes: 0 },
      plannedMinutes: 0,
      missingMinutes: 0,
      counted: countedThrough !== null && month.slice(0, 7) <= countedThrough.slice(0, 7),
    };
  });

  const indexOf = (value: string): number | null => {
    if (Number(value.slice(0, 4)) !== year) return null;
    return Number(value.slice(5, 7)) - 1;
  };

  for (const event of events) {
    const index = indexOf(event.usagePeriod);
    if (index === null) continue;
    const group = groups[index];
    const minutes = Math.round(event.hours * 60);
    const payroll = group.payroll ?? { vacationMinutes: 0, rolMinutes: 0 };
    // A payroll `permit` is confirmed as ROL (F5), so the two are counted as one.
    if (event.kind === "vacation") payroll.vacationMinutes += minutes;
    else payroll.rolMinutes += minutes;
    group.payroll = payroll;
  }

  for (const day of days) {
    const index = indexOf(day.on);
    if (index === null) continue;
    const group = groups[index];
    const minutes = minuteWeight(day, minutesPerDay);
    if (day.kind === "vacation") group.recorded.vacationMinutes += minutes;
    else if (day.kind === "rol") group.recorded.rolMinutes += minutes;
    else group.recorded.otherMinutes += minutes;
    if (dayStatus(day.on, countedThrough) === "planned") group.plannedMinutes += minutes;
  }

  for (const group of groups) {
    if (group.payroll === null) continue;
    const expected = group.payroll.vacationMinutes + group.payroll.rolMinutes;
    const held = group.recorded.vacationMinutes + group.recorded.rolMinutes;
    group.missingMinutes = Math.max(0, expected - held);
  }
  return groups;
}
