// The P&L chart's numbers (docs/design/investments-ux.md §2.2, §7), shared by the home and a
// service's Overview: the running total, the labels it samples and its best and worst interval.
import type { Cents } from "@/platform/money";

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
