// The P&L chart's numbers (docs/design/investments-ux.md §2.2, §7), shared by the home and a
// service's Overview: the running total, the labels it samples and its best and worst interval.
import { formatPercent, type NumberFormat } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/platform/money";

export const toCents = (value: number | null): Cents | null =>
  value === null ? null : BigInt(Math.round(value));

/** The running total of the bars, from zero at the start of the period; a gap stays a gap. */
export function runningTotal(values: readonly (Cents | null)[]): (Cents | null)[] {
  let total: Cents = 0n;
  return values.map((cents) => {
    if (cents === null) return null;
    total += cents;
    return total;
  });
}

/** At most five evenly spread indices, the first and the last always among them. */
export function sampled(length: number, count = 5): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}

/** The best and the worst interval, for the chart's text alternative (§7, A2). */
export function bestAndWorst(values: readonly (Cents | null)[]): { best: number; worst: number } | null {
  let best = -1;
  let worst = -1;
  values.forEach((value, index) => {
    if (value === null) return;
    if (best < 0 || value > values[best]!) best = index;
    if (worst < 0 || value < values[worst]!) worst = index;
  });
  return best < 0 ? null : { best, worst };
}

/**
 * The Return view: each interval's share of the period's return. The period's rate is its P&L over
 * its average capital (Modified Dietz), so an interval's P&L over that same capital is the part of
 * the rate the interval made: the bars add up to the rate in the header. `null` when the period has
 * no rate, or no P&L to read the capital from.
 */
export function returnScale(totalCents: Cents | null, rate: number | null): number | null {
  if (totalCents === null || rate === null || totalCents === 0n || rate === 0) return null;
  return rate / Number(totalCents);
}

/** Money as fractions of the period's capital; a gap stays a gap. */
export function asReturns(values: readonly (Cents | null)[], scale: number): (number | null)[] {
  return values.map((cents) => (cents === null ? null : Number(cents) * scale));
}

/** Axis labels in percent, top to bottom, over the range the values cover; zero always shows. */
export function percentAxisLabels(
  values: readonly (number | null)[],
  format: NumberFormat,
  steps = 4,
): string[] {
  const known = values.filter((value): value is number => value !== null);
  const high = Math.max(...known, 0);
  const low = Math.min(...known, 0);
  return Array.from({ length: steps }, (_, index) =>
    formatPercent(high - ((high - low) * index) / (steps - 1), format, { signed: true }),
  );
}
