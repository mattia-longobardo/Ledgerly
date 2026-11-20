import { addDays, type CivilDate, civilDateIn } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { displayPayee, excludeHidden, payeeKeyOf } from "./records";
import {
  RECURRENCE_AMOUNT_TOLERANCE,
  RECURRENCE_BANDS,
  RECURRENCE_MIN_OCCURRENCES,
  type Cadence,
  type TransactionType,
} from "./vocabulary";
import { abs } from "../../../shared/money";
import { dayNumber } from "../../../shared/dates";

/* Recurrences */

/** A stored movement as recurrence detection sees it. */
export interface RecurrenceInput {
  occurredAt: Date;
  amountCents: Cents;
  currency: string;
  payee: string | null;
  type: TransactionType;
  transferGroupId: string | null;
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
}

/** One detected pattern, in the shape `recurring_patterns` stores (spec §7.2). */
interface DetectedRecurrence {
  payeeKey: string;
  /** The payee as last written by the provider, for display; `payeeKey` is the identity. */
  payee: string;
  currency: string;
  sign: 1 | -1;
  cadence: Cadence;
  intervalDays: number;
  /** The median of the group, signed like its movements. */
  medianCents: Cents;
  occurrences: number;
  lastSeenOn: CivilDate;
  nextExpectedOn: CivilDate;
}

const TOLERANCE_SCALE = 1_000_000n;
const TOLERANCE_SCALED = BigInt(Math.round(RECURRENCE_AMOUNT_TOLERANCE * Number(TOLERANCE_SCALE)));

/** Days since the epoch of a civil date: exact, and the only arithmetic the bands need. */

/** The median of ascending positive amounts; an even count takes the two middles, rounded up. */
function median(sorted: readonly Cents[]): Cents {
  const middle = sorted.length >> 1;
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle] + 1n) / 2n;
}

/** The cadence of an interval in days (spec §7.2): the band it falls in, or none between bands. */
export function cadenceOfInterval(days: number): Cadence | null {
  return RECURRENCE_BANDS.find((one) => days >= one.min && days <= one.max)?.cadence ?? null;
}

/** The cadence every gap shares; `gaps` is never empty (a pattern has at least three movements). */
function cadenceFor(gaps: readonly number[]): Cadence | null {
  const cadence = cadenceOfInterval(gaps[0]);
  return gaps.every((gap) => cadenceOfInterval(gap) === cadence) ? cadence : null;
}

/** The mean gap in whole days, rounded half-up: the column is an integer number of days. */
function meanIntervalDays(gaps: readonly number[]): number {
  const total = gaps.reduce((sum, gap) => sum + gap, 0);
  return Math.floor((2 * total + gaps.length) / (2 * gaps.length));
}

interface Occurrence {
  on: CivilDate;
  amountCents: Cents;
  payee: string;
}

interface Group {
  payeeKey: string;
  currency: string;
  sign: 1 | -1;
  occurrences: Occurrence[];
}

/**
 * The recurring payees of a user, from their own movements (spec §7.2).
 *
 * Transfers and movements with no payee are out, and so is anything hidden or gone from the
 * provider. What is left is grouped by normalised payee, currency and sign — a salary and a direct
 * debit under one name stay two patterns, and so does a payee billing in two currencies. A group
 * is a pattern when it has at least three occurrences, every gap between consecutive dates lands
 * in one single band, and every amount is within 10% of the group's median; amounts are compared
 * in integer cents, so the band cannot drift on a rounding. The next date expected is the last one
 * plus the mean interval.
 *
 * Dates are the user's own civil dates (`timeZone`), never a UTC day: a charge at half past
 * midnight in Rome belongs to the day the person saw it, and that is the day the gaps are measured
 * on. Two movements on the same day leave a gap of zero, which fits no band, so a payee billing
 * twice in one day is not a pattern.
 */
export function detectRecurrences(rows: readonly RecurrenceInput[], timeZone: string): DetectedRecurrence[] {
  const groups = new Map<string, Group>();
  for (const row of excludeHidden(rows)) {
    if (row.type === "transfer" || row.transferGroupId !== null) continue;
    if (row.amountCents === 0n) continue;
    const payeeKey = payeeKeyOf(row.payee);
    const payee = displayPayee(row.payee);
    if (payeeKey === null || payee === null) continue;
    const sign: 1 | -1 = row.amountCents < 0n ? -1 : 1;
    const key = JSON.stringify([payeeKey, row.currency, sign]);
    const group = groups.get(key) ?? { payeeKey, currency: row.currency, sign, occurrences: [] };
    group.occurrences.push({
      on: civilDateIn(row.occurredAt, timeZone),
      amountCents: row.amountCents,
      payee,
    });
    groups.set(key, group);
  }

  const detected: DetectedRecurrence[] = [];
  for (const group of groups.values()) {
    if (group.occurrences.length < RECURRENCE_MIN_OCCURRENCES) continue;
    const sorted = [...group.occurrences].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      gaps.push(dayNumber(sorted[i].on) - dayNumber(sorted[i - 1].on));
    }
    const cadence = cadenceFor(gaps);
    if (cadence === null) continue;

    const amounts = sorted.map((one) => abs(one.amountCents)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const middle = median(amounts);
    const withinBand = amounts.every(
      (amount) => abs(amount - middle) * TOLERANCE_SCALE <= middle * TOLERANCE_SCALED,
    );
    if (!withinBand) continue;

    const last = sorted[sorted.length - 1];
    const intervalDays = meanIntervalDays(gaps);
    detected.push({
      payeeKey: group.payeeKey,
      payee: last.payee,
      currency: group.currency,
      sign: group.sign,
      cadence,
      intervalDays,
      medianCents: group.sign === -1 ? -middle : middle,
      occurrences: sorted.length,
      lastSeenOn: last.on,
      nextExpectedOn: addDays(last.on, intervalDays),
    });
  }

  return detected.sort(
    (a, b) => a.payeeKey.localeCompare(b.payeeKey) || a.currency.localeCompare(b.currency) || a.sign - b.sign,
  );
}
