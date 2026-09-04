import { fromCents, toCents } from "@/lib/calc/money";

export interface AccrualPeriodPoint {
  accrualDate: string;
  net: string;
}

export interface PaidEntryPoint {
  occurredAt: Date;
  net: string;
}

/**
 * `no_data` is distinct from `matched`: it means no accrual records exist
 * for the period at all (the accrual job never ran, or hasn't reached this
 * period yet) — there is no basis to compare against, which is a different
 * fact from "compared, and nothing was owed." Reporting `matched` for an
 * empty accrual list would be an affirmative claim made from zero evidence.
 */
export type ReconciliationStatus = "matched" | "missing" | "delayed" | "anomalous" | "no_data";

export interface ReconciliationSummary {
  periodStart: string;
  periodEnd: string;
  accruedTotal: string;
  paidTotal: string;
  status: ReconciliationStatus;
  differenceCents: number;
}

/**
 * Sums `net` amounts to integer cents via `toCents` (regex-parsed, never
 * `Number()`). `toCents` itself funnels the whole-currency part through a
 * JS `number`: exact below roughly 9.0×10¹³ cents (~€900 billion), and
 * unbounded-but-inexact above that — no realistic interest total reaches
 * it, but nothing enforces the ceiling. A value that fails to parse is a
 * data integrity problem, not a zero - swallowing it would silently
 * understate the total instead of surfacing the bad record.
 */
function sumNetCents(entries: readonly { net: string }[]): number {
  return entries.reduce((sum, entry) => {
    const cents = toCents(entry.net);
    if (cents === null) throw new Error(`reconcileInterest: could not parse net amount "${entry.net}"`);
    return sum + cents;
  }, 0);
}

/**
 * Compares what the accrual ledger says was earned in a period against what
 * actually landed as a paid entry. The caller is responsible for scoping
 * both lists to the period - this function only echoes `period` back onto
 * the summary for display, it does not filter by date itself.
 *
 * An empty `accruals` list means the accrual job produced no records for
 * this period at all - a missing basis for comparison, not evidence that
 * nothing was owed - so it is reported as `no_data` regardless of what (if
 * anything) was paid, rather than `matched`. A paid entry with no accrual
 * basis is still worth flagging (`anomalous`), but only once there is at
 * least one accrual record to say the ledger was actually evaluated for
 * the period; with zero accrual records, `anomalous` would imply a
 * confidence about what *should* have happened that isn't there either.
 *
 * Once there is a basis, a difference of one cent or less is rounding
 * noise, not a discrepancy - a real provider posting rounds its own
 * running total its own way, independent of this ledger's day-by-day
 * carry.
 */
export function reconcileInterest(
  accruals: readonly AccrualPeriodPoint[],
  paidEntries: readonly PaidEntryPoint[],
  period: { start: string; end: string },
): ReconciliationSummary {
  const accruedCents = sumNetCents(accruals);
  const paidCents = sumNetCents(paidEntries);
  const differenceCents = paidCents - accruedCents;

  let status: ReconciliationStatus;
  if (accruals.length === 0) status = "no_data";
  else if (Math.abs(differenceCents) <= 1) status = "matched";
  else if (paidCents === 0 && accruedCents > 0) status = "missing";
  else if (paidCents < accruedCents) status = "delayed";
  else status = "anomalous";

  return {
    periodStart: period.start,
    periodEnd: period.end,
    accruedTotal: fromCents(accruedCents).toFixed(2),
    paidTotal: fromCents(paidCents).toFixed(2),
    status,
    differenceCents,
  };
}
