import type { MonthPoint } from "@/lib/contracts";
import { fromCents, toCents } from "@/lib/calc/money";
import { monthKeyOf } from "@/lib/time";
import type { BalancePoint } from "./account";

/**
 * One point per requested month: the last balance captured that month, or
 * (when the month had no capture) the most recent balance carried forward.
 * `null` until the first known balance.
 */
export function monthlySeries(points: readonly BalancePoint[], months: readonly string[]): MonthPoint[] {
  const lastByMonth = new Map<string, BalancePoint>();
  const ordered = [...points].sort(
    (x, y) => x.asOf.localeCompare(y.asOf) || x.capturedAt.getTime() - y.capturedAt.getTime(),
  );
  for (const p of ordered) lastByMonth.set(monthKeyOf(p.asOf), p);
  let carry: number | null = null;
  return months.map((month) => {
    const hit = lastByMonth.get(month);
    if (hit) carry = toCents(hit.balance);
    return { month, value: carry === null ? null : fromCents(carry) };
  });
}

/** Sums per-account monthly series in integer cents, month by month. */
export function totalSeries(perAccount: readonly (readonly MonthPoint[])[], months: readonly string[]): MonthPoint[] {
  return months.map((month, i) => {
    let sum: number | null = null;
    for (const series of perAccount) {
      const v = series[i]?.value ?? null;
      if (v !== null) sum = (sum ?? 0) + (toCents(v) ?? 0);
    }
    return { month, value: sum === null ? null : fromCents(sum) };
  });
}
