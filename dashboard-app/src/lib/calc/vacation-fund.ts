import type { MonthPoint } from "@/lib/contracts";
import { monthKeyOf, monthRange, romeDate } from "@/lib/time";
import { fromCents, sumCents, toCents, type MoneyInput } from "./money";

export interface LedgerEntry {
  entryType?: string;
  month?: string | null;
  amount: MoneyInput;
  occurredAt?: Date | string | null;
}

export interface AccrualRateRow {
  effectiveFrom: string;
  monthlyAmount: MoneyInput;
}

export interface ExpectedAccrual {
  month: string;
  amount: number;
}

/** Signed ledger: accruals positive, withdrawals negative. */
export function fundBalance(ledger: readonly LedgerEntry[]): number {
  return fromCents(sumCents(ledger.map((e) => e.amount)));
}

export function effectiveRate(rates: readonly AccrualRateRow[], month: string): number | null {
  const key = monthKeyOf(month);
  const row = [...rates]
    .filter((rate) => monthKeyOf(rate.effectiveFrom) <= key)
    .sort((a, b) => monthKeyOf(b.effectiveFrom).localeCompare(monthKeyOf(a.effectiveFrom)))[0] ?? null;
  return row === null ? null : fromCents(toCents(row.monthlyAmount));
}

/**
 * A rate row applies from its own month onwards only, so changing the monthly
 * amount can never rewrite what past months were expected to accrue. Months
 * before the first rate row have no expectation and are omitted.
 */
export function expectedAccruals(
  rates: readonly AccrualRateRow[],
  fromMonth: string,
  toMonth: string,
): ExpectedAccrual[] {
  const out: ExpectedAccrual[] = [];
  for (const month of monthRange(monthKeyOf(fromMonth), monthKeyOf(toMonth))) {
    const amount = effectiveRate(rates, month);
    if (amount === null) continue;
    out.push({ month, amount });
  }
  return out;
}

function entryMonth(e: LedgerEntry): string | null {
  if (e.month) return monthKeyOf(e.month);
  if (e.occurredAt instanceof Date) return monthKeyOf(romeDate(e.occurredAt));
  if (typeof e.occurredAt === "string") return monthKeyOf(e.occurredAt);
  return null;
}

/** Running balance on a continuous month axis. Entries that carry neither a
 * month nor an occurrence date cannot be placed and are left out. */
export function balanceSeries(ledger: readonly LedgerEntry[]): MonthPoint[] {
  const byMonth = new Map<string, number>();
  for (const e of ledger) {
    const m = entryMonth(e);
    if (m === null) continue;
    byMonth.set(m, (byMonth.get(m) ?? 0) + (toCents(e.amount) ?? 0));
  }
  const months = [...byMonth.keys()].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return [];
  let running = 0;
  return monthRange(first, last).map((month) => {
    running += byMonth.get(month) ?? 0;
    return { month, value: fromCents(running) };
  });
}

/** Balance the ledger would hold after withdrawing `amount` (sign-insensitive). */
export function withdrawalPreview(ledger: readonly LedgerEntry[], amount: MoneyInput): number {
  const balance = sumCents(ledger.map((e) => e.amount));
  return fromCents(balance - Math.abs(toCents(amount) ?? 0));
}
