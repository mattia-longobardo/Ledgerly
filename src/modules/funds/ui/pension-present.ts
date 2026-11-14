import { formatDate, type UiLocale } from "@/platform/format";
import type { Status } from "../pension/reconcile";
import { type AccrualPeriod, periodStart } from "../sources";

/** How each reconciliation state reads (design, GC §11): a colour never carries it alone. */
export const STATUS_TONE: Record<Status, "pos" | "neg" | "warn" | "accent" | "neutral"> = {
  reconciled: "pos",
  invested: "pos",
  // Nothing accused it and nothing confirmed it: the schedule says it left, which is a settled
  // state, not a warning.
  transferred: "pos",
  present: "accent",
  accrued_not_due: "neutral",
  to_verify: "warn",
  incomplete: "warn",
  discrepancy: "neg",
};

/** "II 2026" — the quarter as the fund's own documents write it. */
export function quarterLabel(year: number, quarter: number): string {
  return `${["I", "II", "III", "IV"][quarter - 1]} ${year}`;
}

/**
 * A period of a payslip source, as the register and the reconciliation name it: the month and its
 * year for a source that accrues by month, the quarter in words for one that accrues by quarter.
 * `quarter` is the message that says a quarter ("3° trim. 2026"); without it the quarter reads as
 * the fund's documents write it.
 */
export function periodLabel(
  period: AccrualPeriod,
  year: number,
  index: number,
  locale: UiLocale,
  quarter?: (values: { index: number; year: number }) => string,
): string {
  if (period === "month") return formatDate(periodStart(year, index, "month"), "monthYear", locale);
  return quarter ? quarter({ index, year }) : quarterLabel(year, index);
}
