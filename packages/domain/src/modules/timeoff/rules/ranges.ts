import { type CivilDate } from "../../../shared/dates";
import { LEAVE_DAY_KINDS, bookable, goesToCalendar, type LeaveDayKind, type LeaveDayView } from "./days";
import { datesBetween } from "./inputs";
import { byDeclaredOrder, residual, type ResidualInput } from "./residual";

/* The kinds as a list (anticipation AN1 of the rewrite plan) */

/** The kinds that spend a yearly allowance, and so have a residual to show. */
const BALANCE_KINDS = ["vacation", "rol"] as const;

/**
 * One kind of leave as a screen is handed it: an entry of a list, not a name written in a component.
 *
 * The list is built from today's fixed kinds and will come from a table (R5g) without the panel
 * that reads it changing. `selectable` is `false` for sickness: it is not a kind of leave anybody
 * books here any more (decisions H20 and ST-27), but the rows that already carry it are still
 * shown and still edited, so the entry stays in the list.
 */
export interface LeaveType {
  id: LeaveDayKind;
  /** Whether a new day off may be given this kind. */
  selectable: boolean;
  /** Whether the kind spends an allowance. */
  hasBalance: boolean;
  /** Whether the kind stays here and is never told to the calendar. */
  local: boolean;
}

export const LEAVE_TYPES: readonly LeaveType[] = LEAVE_DAY_KINDS.map((id) => ({
  id,
  selectable: id !== "sick",
  hasBalance: (BALANCE_KINDS as readonly string[]).includes(id),
  local: !goesToCalendar(id),
}));

/** The kind "Add the other half" proposes beside a half day: ROL beside vacation, vacation otherwise. */
export function otherHalfOf(kind: LeaveDayKind): LeaveDayKind {
  return kind === "vacation" ? "rol" : "vacation";
}

/* What a range would write, before anything is written (rewrite plan N5) */

/** The fields of the leave panel, as the rules read them. */
interface LeaveRangeInput {
  from: CivilDate;
  to: CivilDate;
  kind: LeaveDayKind;
  /** Half a day or a whole one, for every day of the range. */
  fraction: number;
  /**
   * Set when the panel edits a row instead of adding one: the kind that row has now. The row is
   * the one on `from`, and it is what the input replaces — so it is neither counted against the
   * day nor reported as something the range takes away.
   */
  editedKind?: LeaveDayKind | null;
  /**
   * Set when every day is split: half a day of `kind` and half a day of this one, written together
   * (decision of 17/11/2026). `fraction` is then 0.5.
   */
  otherKind?: LeaveDayKind | null;
}

/** What one day of a range holds once written: one row, or the two halves of a split day. */
export function rangeParts(input: Pick<LeaveRangeInput, "kind" | "fraction" | "otherKind">): LeaveDayView[] {
  const other = input.otherKind ?? null;
  return other === null || other === input.kind
    ? [{ on: "", kind: input.kind, fraction: input.fraction }]
    : [
        { on: "", kind: input.kind, fraction: 0.5 },
        { on: "", kind: other, fraction: 0.5 },
      ];
}

interface LeaveRangeContext {
  /** The rows already booked: at least every row of the range. */
  days: readonly LeaveDayView[];
  holidays: ReadonlySet<CivilDate>;
  /** The residual inputs of the kinds that have one, each with the days of `year` only. */
  residuals?: Partial<Record<LeaveDayKind, ResidualInput>>;
  /** The year the residuals are about; days of another year are written and not counted. */
  year?: number | null;
}

/** A row the range changes on its way: taken away, or kept with another size. */
interface ReplacedRow extends LeaveDayView {
  change: "removed" | "resized";
}

interface BalanceChange {
  kind: LeaveDayKind;
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
  /** The written days that are not in `year`. */
  otherYearDays: number;
  /** The residual before and after, for the range's own kind and for every kind a replacement frees. */
  balances: BalanceChange[];
  /** The rows as they will be once the range is written. */
  after: LeaveDayView[];
}

/**
 * What a range would do, worked out from what is already booked — the one answer the panel shows
 * before "Confirm" and the service writes after it, so the two cannot disagree.
 *
 * A day never ends up holding more than a whole day off:
 *  1. the row of the same kind is updated in place;
 *  2. when the new row and the rows of other kinds come to more than a day, the others go;
 *  3. when they do not — a new half beside a half of another kind — the two stay together.
 *
 * A split day (`otherKind`) writes two halves at once, each by rule 1; any third kind goes by rule 2.
 *
 * Nothing here is a new rule about residuals: "after" is {@link residual} again, over the days as
 * they will be. A residual below zero is an ordinary answer and not an error — the page is also
 * where leave is planned.
 */
export function previewLeaveRange(input: LeaveRangeInput, context: LeaveRangeContext): LeaveRangePreview {
  const { from, to } = input;
  const kind = input.kind;
  const parts = rangeParts(input);
  const partKinds = new Set(parts.map((part) => part.kind));
  const perDay = parts.reduce((sum, part) => sum + part.fraction, 0);
  const editedKind = input.editedKind ?? null;
  const year = context.year ?? null;
  const inYear = (date: CivilDate) => year === null || Number(date.slice(0, 4)) === year;

  const written: CivilDate[] = [];
  const excluded: LeaveRangePreview["excluded"] = [];
  for (const date of datesBetween(from, to)) {
    const verdict = bookable(date, context.holidays);
    if (verdict.ok) written.push(date);
    else excluded.push({ on: date, reason: verdict.reason });
  }

  const byDate = new Map<CivilDate, LeaveDayView[]>();
  for (const day of context.days) byDate.set(day.on, [...(byDate.get(day.on) ?? []), day]);

  const replaced: ReplacedRow[] = [];
  const removed: LeaveDayView[] = [];
  for (const date of written) {
    const rows = byDate.get(date) ?? [];
    const edited = date === from && editedKind !== null ? editedKind : null;
    if (edited !== null && !partKinds.has(edited)) {
      removed.push(...rows.filter((row) => row.kind === edited));
    }
    for (const part of parts) {
      const same = rows.find((row) => row.kind === part.kind);
      if (same !== undefined && same.fraction !== part.fraction && edited !== part.kind) {
        replaced.push({ ...same, change: "resized" });
      }
    }
    const others = rows.filter((row) => !partKinds.has(row.kind) && row.kind !== edited);
    if (perDay + others.reduce((sum, row) => sum + row.fraction, 0) > 1) {
      for (const row of others) {
        replaced.push({ ...row, change: "removed" });
        removed.push(row);
      }
    }
  }

  const gone = new Set(removed.map((row) => `${row.on} ${row.kind}`));
  const rewritten = new Set(written.flatMap((date) => parts.map((part) => `${date} ${part.kind}`)));
  const after: LeaveDayView[] = [
    ...context.days.filter((day) => {
      const key = `${day.on} ${day.kind}`;
      return !gone.has(key) && !rewritten.has(key);
    }),
    ...written.filter(inYear).flatMap((on) => parts.map((part) => ({ ...part, on }))),
  ].sort((a, b) => (a.on === b.on ? byDeclaredOrder(a.kind, b.kind) : a.on < b.on ? -1 : 1));

  const balances: BalanceChange[] = [];
  for (const one of LEAVE_DAY_KINDS) {
    const residualInput = context.residuals?.[one];
    if (residualInput === undefined) continue;
    const beforeMinutes = residual(residualInput).remainingMinutes;
    const afterMinutes = residual({
      ...residualInput,
      days: after.filter((day) => day.kind === one),
    }).remainingMinutes;
    if (one === kind || beforeMinutes !== afterMinutes) {
      balances.push({ kind: one, beforeMinutes, afterMinutes });
    }
  }

  return {
    written,
    excluded,
    replaced: replaced.sort((a, b) =>
      a.on === b.on ? byDeclaredOrder(a.kind, b.kind) : a.on < b.on ? -1 : 1,
    ),
    removed,
    totalDays: written.length * perDay,
    otherYearDays: written.filter((date) => !inYear(date)).length,
    balances,
    after,
  };
}
