// The period of the URL (docs/design/investments-ux.md §1.2, §2.1), as the engine of the P&L reads it.
import { type CivilDate, isCivilDate } from "../../../shared/dates";
import { allPeriod, isFutureYear, type Period, yearPeriod } from "../../../shared/period";
import type { Book } from "../rules";

// ——— The period (§1.2, §2.1) ————————————————————————————————————————————————————————————————

/** The period of the pages (shared/period). */
export type { Period as PnlPeriod };

export interface PeriodParams {
  period?: string | null;
  from?: string | null;
  to?: string | null;
}

/**
 * The period of the URL (§1.2): `from`/`to` by day win over `period`; `period` is a year or `all`;
 * nothing, or anything else, is the year running ("2026 · year to date"). A year to come, a range
 * that ends before it starts or starts after today fall back to the default; a range that ends
 * after today stops today.
 */
export function periodOf(params: PeriodParams, todayOn: CivilDate): Period {
  const yearOf = (year: number): Period => ({ kind: "year", year, ...yearPeriod(year, todayOn) });
  const { from, to } = params;
  if (from && to && isCivilDate(from) && isCivilDate(to) && from <= to && from <= todayOn) {
    return { kind: "custom", year: null, from, to: to < todayOn ? to : todayOn };
  }
  if (params.period === "all") return { kind: "all", year: null, ...allPeriod(todayOn) };
  if (params.period && /^\d{4}$/.test(params.period)) {
    const year = Number(params.period);
    if (year >= 1970 && !isFutureYear(params.period, todayOn)) return yearOf(year);
  }
  return yearOf(Number(todayOn.slice(0, 4)));
}

/** The first day the book knows anything of: its first period or its first event. */
export function firstDayOf(book: Book): CivilDate | null {
  const days = [...book.periods.map((period) => period.fromOn), ...book.events.map((event) => event.on)];
  return days.length === 0 ? null : days.reduce((a, b) => (a < b ? a : b));
}
