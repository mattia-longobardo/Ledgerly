import { fromCents, toCents } from "@/lib/calc/money";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

export interface RecurringCandidate {
  payee: string;
  amount: string;
  currency: string;
  occurredAt: Date;
}

export interface DetectedPattern {
  payee: string;
  cadence: Cadence;
  amountLow: string;
  amountHigh: string;
  currency: string;
  lastSeenAt: Date;
  nextExpectedAt: Date;
  occurrenceCount: number;
}

const DAY_MS = 86_400_000;

/** Two occurrences are a coincidence, not a pattern — three is the floor. */
const MIN_OCCURRENCES = 3;

/** Amounts within 10% of the group's median are "the same" recurring charge. */
const AMOUNT_BAND = 0.1;

const CADENCE_DAY_BANDS: Record<Cadence, readonly [number, number]> = {
  weekly: [5, 9],
  biweekly: [12, 16],
  monthly: [26, 34],
  quarterly: [80, 100],
  annual: [350, 380],
};

function cadenceFor(gaps: readonly number[]): Cadence | undefined {
  return (Object.entries(CADENCE_DAY_BANDS) as Array<[Cadence, readonly [number, number]]>).find(
    ([, [lo, hi]]) => gaps.every((g) => g >= lo && g <= hi),
  )?.[0];
}

/**
 * Groups by payee (case-insensitive), then looks for three or more gaps that
 * all land in the same cadence's day band, with amounts within 10% of the
 * group's median — the same median-band shape `payroll/confidence.ts` uses
 * for fund reconciliation. Amounts are compared in integer cents (never as
 * parsed floats) so the band check can't drift on rounding. Two occurrences
 * are never enough: one repeat is a coincidence, not a pattern.
 */
export function detectRecurring(transactions: readonly RecurringCandidate[]): DetectedPattern[] {
  const byPayee = new Map<string, RecurringCandidate[]>();
  for (const t of transactions) {
    const key = t.payee.trim().toLowerCase();
    if (!key) continue;
    const list = byPayee.get(key) ?? [];
    list.push(t);
    byPayee.set(key, list);
  }

  const patterns: DetectedPattern[] = [];
  for (const group of byPayee.values()) {
    if (group.length < MIN_OCCURRENCES) continue;

    const sorted = [...group].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push((sorted[i]!.occurredAt.getTime() - sorted[i - 1]!.occurredAt.getTime()) / DAY_MS);
    }
    const cadence = cadenceFor(gaps);
    if (!cadence) continue;

    const parsedCents = sorted.map((t) => toCents(t.amount));
    if (parsedCents.some((c) => c === null)) continue;
    const cents = parsedCents.map((c) => Math.abs(c!)).sort((a, b) => a - b);
    const median = cents[Math.floor(cents.length / 2)]!;
    if (median === 0 || !cents.every((c) => Math.abs(c - median) <= median * AMOUNT_BAND)) continue;

    const last = sorted[sorted.length - 1]!;
    const avgGapDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    patterns.push({
      payee: last.payee,
      cadence,
      amountLow: fromCents(cents[0]!).toFixed(2),
      amountHigh: fromCents(cents[cents.length - 1]!).toFixed(2),
      currency: last.currency,
      lastSeenAt: last.occurredAt,
      nextExpectedAt: new Date(last.occurredAt.getTime() + avgGapDays * DAY_MS),
      occurrenceCount: sorted.length,
    });
  }
  return patterns;
}
