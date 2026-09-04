import { fromCents, toCents } from "@/lib/calc/money";

export interface AccrualPeriodPoint {
  accrualDate: string;
  net: string;
}

export interface PaidEntryPoint {
  occurredAt: Date;
  net: string;
}

export type ReconciliationStatus = "matched" | "missing" | "delayed" | "anomalous";

export interface ReconciliationSummary {
  periodStart: string;
  periodEnd: string;
  accruedTotal: string;
  paidTotal: string;
  status: ReconciliationStatus;
  differenceCents: number;
}

/**
 * Sums `net` amounts to integer cents. A value that fails to parse is a data
 * integrity problem, not a zero - swallowing it would silently understate
 * the total instead of surfacing the bad record.
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
 * the summary for display, it does not filter by date itself. A difference
 * of one cent or less is rounding noise, not a discrepancy - a real
 * provider posting rounds its own running total its own way, independent
 * of this ledger's day-by-day carry.
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
  if (Math.abs(differenceCents) <= 1) status = "matched";
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
