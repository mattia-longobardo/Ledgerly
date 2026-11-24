import { type CivilDate } from "../../../shared/dates";
import { bookable, byTypeOrder, DEFAULT_WORK_DAYS, type LeaveDayView, type LeaveType } from "./days";
import { datesBetween } from "./inputs";
import { residual, type ResidualInput } from "./residual";

/**
 * The type "Add the other half" proposes beside a half day: the first other type with an
 * allowance, else the first other type; `null` when the person has no other type.
 */
export function otherHalfOf(types: readonly LeaveType[], typeId: string): string | null {
  const others = types.filter((type) => type.id !== typeId && type.unit === "half_day");
  return (others.find((type) => type.hasAllowance) ?? others[0])?.id ?? null;
}

/* What a range would write, before anything is written (rewrite plan N5) */

/** The fields of the leave panel, as the rules read them. */
interface LeaveRangeInput {
  from: CivilDate;
  to: CivilDate;
  typeId: string;
  /** Half a day or a whole one, for every day of the range. */
  fraction: number;
  /** For a type counted in hours: the length of every day of the range; `fraction` is then its nearest size. */
  minutes?: number | null;
  /**
   * Set when the panel edits a row instead of adding one: the type that row has now. The row is
   * the one on `from`, and it is what the input replaces — so it is neither counted against the
   * day nor reported as something the range takes away.
   */
  editedTypeId?: string | null;
  /**
   * Set when every day is split: half a day of `typeId` and half a day of this one, written
   * together (decision of 17/11/2026). `fraction` is then 0.5.
   */
  otherTypeId?: string | null;
}

/** What one day of a range holds once written: one row, or the two halves of a split day. */
export function rangeParts(
  input: Pick<LeaveRangeInput, "typeId" | "fraction" | "minutes" | "otherTypeId">,
): LeaveDayView[] {
  const other = input.otherTypeId ?? null;
  const minutes = input.minutes ?? null;
  return other === null || other === input.typeId
    ? [{ on: "", typeId: input.typeId, fraction: input.fraction, minutes }]
    : [
        { on: "", typeId: input.typeId, fraction: 0.5, minutes: null },
        { on: "", typeId: other, fraction: 0.5, minutes: null },
      ];
}

interface LeaveRangeContext {
  /** The rows already booked: at least every row of the range. */
  days: readonly LeaveDayView[];
  holidays: ReadonlySet<CivilDate>;
  /** The person's types, in their order: the order of every list here. */
  types: readonly Pick<LeaveType, "id">[];
  /** The days of the week the person works; Monday to Friday when absent. */
  workDays?: readonly number[];
  /** The length of the person's working day, for the rows counted in hours. */
  minutesPerDay?: number;
  /** The residual inputs of the types that have one, by type id, each with the days of the year only. */
  residuals?: Partial<Record<string, ResidualInput>>;
  /** The days of the year the residuals are about; days outside are written and not counted. */
  window?: { from: CivilDate; to: CivilDate } | null;
}

/** A row the range changes on its way: taken away, or kept with another size. */
interface ReplacedRow extends LeaveDayView {
  change: "removed" | "resized";
}

interface BalanceChange {
  typeId: string;
  /** `null` when nobody can compute the residual: no payslip and no allowance. */
  beforeMinutes: number | null;
  afterMinutes: number | null;
}

interface LeaveRangePreview {
  /** The days that get a row, ascending. */
  written: CivilDate[];
  /** The days of the range nobody can book, with the reason. */
  excluded: { on: CivilDate; reason: "weekend" | "holiday" }[];
  /** The rows the panel lists under "Replaces". */
  replaced: ReplacedRow[];
  /** Every row that goes, the edited one included: what the service takes away. */
  removed: LeaveDayView[];
  /** What the range comes to, in days. */
  totalDays: number;
  /** The written days that are not in the year's window. */
  otherYearDays: number;
  /** The residual before and after, for the range's own type and for every type a replacement frees. */
  balances: BalanceChange[];
  /** The rows as they will be once the range is written. */
  after: LeaveDayView[];
}

/**
 * What a range would do, worked out from what is already booked — the one answer the panel shows
 * before "Confirm" and the service writes after it, so the two cannot disagree.
 *
 * A day never ends up holding more than a whole day off:
 *  1. the row of the same type is updated in place;
 *  2. when the new row and the rows of other types come to more than a day, the others go;
 *  3. when they do not — a new half beside a half of another type — the two stay together.
 *
 * A split day (`otherTypeId`) writes two halves at once, each by rule 1; any third type goes by rule 2.
 *
 * Nothing here is a new rule about residuals: "after" is {@link residual} again, over the days as
 * they will be. A residual below zero is an ordinary answer and not an error — the page is also
 * where leave is planned.
 */
export function previewLeaveRange(input: LeaveRangeInput, context: LeaveRangeContext): LeaveRangePreview {
  const { from, to } = input;
  const typeId = input.typeId;
  const parts = rangeParts(input);
  const partTypes = new Set(parts.map((part) => part.typeId));
  const minutesPerDay = context.minutesPerDay ?? 480;
  // A row's share of a day: its fraction, or its hours against the working day.
  const share = (row: LeaveDayView) => (row.minutes == null ? row.fraction : row.minutes / minutesPerDay);
  const perDay = parts.reduce((sum, part) => sum + share(part), 0);
  const editedTypeId = input.editedTypeId ?? null;
  const window = context.window ?? null;
  const inYear = (date: CivilDate) => window === null || (date >= window.from && date <= window.to);
  const order = byTypeOrder(context.types);
  const byDayThenType = (a: LeaveDayView, b: LeaveDayView) =>
    a.on === b.on ? order(a.typeId, b.typeId) : a.on < b.on ? -1 : 1;

  const written: CivilDate[] = [];
  const excluded: LeaveRangePreview["excluded"] = [];
  for (const date of datesBetween(from, to)) {
    const verdict = bookable(date, context.holidays, context.workDays ?? DEFAULT_WORK_DAYS);
    if (verdict.ok) written.push(date);
    else excluded.push({ on: date, reason: verdict.reason });
  }

  const byDate = new Map<CivilDate, LeaveDayView[]>();
  for (const day of context.days) byDate.set(day.on, [...(byDate.get(day.on) ?? []), day]);

  const replaced: ReplacedRow[] = [];
  const removed: LeaveDayView[] = [];
  for (const date of written) {
    const rows = byDate.get(date) ?? [];
    const edited = date === from && editedTypeId !== null ? editedTypeId : null;
    if (edited !== null && !partTypes.has(edited)) {
      removed.push(...rows.filter((row) => row.typeId === edited));
    }
    for (const part of parts) {
      const same = rows.find((row) => row.typeId === part.typeId);
      if (same !== undefined && share(same) !== share(part) && edited !== part.typeId) {
        replaced.push({ ...same, change: "resized" });
      }
    }
    const others = rows.filter((row) => !partTypes.has(row.typeId) && row.typeId !== edited);
    if (perDay + others.reduce((sum, row) => sum + share(row), 0) > 1) {
      for (const row of others) {
        replaced.push({ ...row, change: "removed" });
        removed.push(row);
      }
    }
  }

  const gone = new Set(removed.map((row) => `${row.on} ${row.typeId}`));
  const rewritten = new Set(written.flatMap((date) => parts.map((part) => `${date} ${part.typeId}`)));
  const after: LeaveDayView[] = [
    ...context.days.filter((day) => {
      const key = `${day.on} ${day.typeId}`;
      return !gone.has(key) && !rewritten.has(key);
    }),
    ...written.filter(inYear).flatMap((on) => parts.map((part) => ({ ...part, on }))),
  ].sort(byDayThenType);

  const balances: BalanceChange[] = [];
  for (const one of context.types) {
    const residualInput = context.residuals?.[one.id];
    if (residualInput === undefined) continue;
    const beforeMinutes = residual(residualInput).remainingMinutes;
    const afterMinutes = residual({
      ...residualInput,
      days: after.filter((day) => day.typeId === one.id),
    }).remainingMinutes;
    if (one.id === typeId || beforeMinutes !== afterMinutes) {
      balances.push({ typeId: one.id, beforeMinutes, afterMinutes });
    }
  }

  return {
    written,
    excluded,
    replaced: replaced.sort(byDayThenType),
    removed,
    totalDays: written.length * perDay,
    otherYearDays: written.filter((date) => !inYear(date)).length,
    balances,
    after,
  };
}
