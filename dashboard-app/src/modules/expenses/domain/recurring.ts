import { fromCents, toCents } from "@/lib/calc/money";

export type Cadence = "weekly" | "biweekly" | "monthly" | "quarterly" | "annual";

/** The sign of the group's amounts — part of the grouping key, so it is part of the persisted identity of a pattern too. */
export type PatternSign = "+" | "-";

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
  /** Same sign as every candidate in the group — see `PatternSign`. */
  sign: PatternSign;
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

interface ParsedCandidate {
  readonly candidate: RecurringCandidate;
  /** Signed integer cents — never a parsed float. */
  readonly cents: number;
}

/**
 * Groups by payee (case-insensitive), currency and amount sign — a debit and
 * an unrelated credit of the same magnitude, or the same payee billing in two
 * currencies, must never be treated as one series just because they share a
 * name. Within each group, looks for three or more gaps that all land in the
 * same cadence's day band, with amounts within 10% of the group's median —
 * the same median-band shape `payroll/confidence.ts` uses for fund
 * reconciliation. Amounts are compared in integer cents (never as parsed
 * floats) so the band check can't drift on rounding; a candidate whose amount
 * fails to parse, or is exactly zero (no sign to group by), is dropped rather
 * than guessed at. Two occurrences are never enough: one repeat is a
 * coincidence, not a pattern.
 */
export function detectRecurring(transactions: readonly RecurringCandidate[]): DetectedPattern[] {
  const byGroup = new Map<string, ParsedCandidate[]>();
  for (const t of transactions) {
    const payeeKey = t.payee.trim().toLowerCase();
    if (!payeeKey) continue;
    const cents = toCents(t.amount);
    if (cents === null || cents === 0) continue;
    const key = `${payeeKey} ${t.currency} ${cents < 0 ? "-" : "+"}`;
    const list = byGroup.get(key) ?? [];
    list.push({ candidate: t, cents });
    byGroup.set(key, list);
  }

  const patterns: DetectedPattern[] = [];
  for (const group of byGroup.values()) {
    if (group.length < MIN_OCCURRENCES) continue;

    const sorted = [...group].sort(
      (a, b) => a.candidate.occurredAt.getTime() - b.candidate.occurredAt.getTime(),
    );

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(
        (sorted[i]!.candidate.occurredAt.getTime() - sorted[i - 1]!.candidate.occurredAt.getTime()) / DAY_MS,
      );
    }
    const cadence = cadenceFor(gaps);
    if (!cadence) continue;

    const absCents = sorted.map((p) => Math.abs(p.cents)).sort((a, b) => a - b);
    const median = absCents[Math.floor(absCents.length / 2)]!;
    if (!absCents.every((c) => Math.abs(c - median) <= median * AMOUNT_BAND)) continue;

    const last = sorted[sorted.length - 1]!.candidate;
    const avgGapDays = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    patterns.push({
      payee: last.payee,
      cadence,
      amountLow: fromCents(absCents[0]!).toFixed(2),
      amountHigh: fromCents(absCents[absCents.length - 1]!).toFixed(2),
      currency: last.currency,
      // Every member of a group shares one sign (it is part of the grouping
      // key above), so the first entry's sign speaks for the whole group.
      sign: group[0]!.cents < 0 ? "-" : "+",
      lastSeenAt: last.occurredAt,
      nextExpectedAt: new Date(last.occurredAt.getTime() + avgGapDays * DAY_MS),
      occurrenceCount: sorted.length,
    });
  }
  return patterns;
}
