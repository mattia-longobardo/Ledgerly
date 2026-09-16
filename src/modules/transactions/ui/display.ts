/**
 * What the Expenses screen shows, decided away from the markup: the badges a row carries, the
 * colour a category is drawn in, the bars of the "By category" card and the label of a date
 * range. Pure functions, unit-tested, so the components stay layout and nothing else.
 */

import { PALETTE } from "@/modules/accounts/ui/display";
import type { TransactionState, TransactionType } from "@/modules/transactions/rules";
import { type CivilDate, type MonthKey } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { type DateRange, isSingleMonth } from "./filters";

/** A category's own colour wins; the ones without get a stable one from the shared palette. */
export function categoryColor(color: string | null, index: number): string {
  return color ?? PALETTE[index % PALETTE.length];
}

/** The five markers of spec §7.2, in the order the row shows them. */
export const ROW_BADGES = ["hidden", "removedUpstream", "edited", "transfer", "pending"] as const;

export type RowBadge = (typeof ROW_BADGES)[number];

export interface BadgeSource {
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
  locallyEdited: readonly string[];
  type: TransactionType;
  transferGroupId: string | null;
  state: TransactionState;
}

/**
 * Why a row does not simply count (spec §7.2). "Hidden" and "gone from the provider" are two
 * different facts even though both keep the row out of the totals: one is a decision of the
 * person, the other one of Wallet, and only the first is theirs to undo.
 */
export function badgesOf(row: BadgeSource): RowBadge[] {
  const badges: RowBadge[] = [];
  if (row.hiddenAt !== null) badges.push("hidden");
  if (row.removedUpstreamAt !== null) badges.push("removedUpstream");
  if (row.locallyEdited.length > 0) badges.push("edited");
  if (row.type === "transfer" || row.transferGroupId !== null) badges.push("transfer");
  if (row.state === "pending") badges.push("pending");
  return badges;
}

export interface BreakdownInput {
  id: string;
  name: string;
  color: string;
  cents: Cents;
}

export interface BreakdownBar extends BreakdownInput {
  /** Share of everything the range spends, for the composition strip and the percentage. */
  share: number;
  /** Share of the largest single category, which is what the design's row bar measures. */
  width: number;
}

/** The "By category" card as it is drawn: the rows, and the total those rows come to. */
export interface Breakdown {
  bars: BreakdownBar[];
  /**
   * What the rows of the card add up to, measured the way the card measures them: by size. It is
   * the whole the shares are shares of, so the heading of the card and its rows can never
   * disagree. Summed here, on `bigint` cents and on the server, never in the browser (spec §8.5).
   */
  totalCents: Cents;
}

/**
 * The "By category" card of the design, biggest first.
 *
 * Amounts are compared by size and not by sign: a category is a slice of what the range moved,
 * and an income category would otherwise eat the bar of everything next to it. A range whose
 * categories cancel each other out to zero has no shares at all rather than shares of infinity.
 */
export function categoryBreakdown(items: readonly BreakdownInput[]): Breakdown {
  const magnitude = (cents: Cents) => (cents < 0n ? -cents : cents);
  const sorted = [...items]
    .filter((item) => item.cents !== 0n)
    .sort((a, b) => {
      const difference = magnitude(b.cents) - magnitude(a.cents);
      if (difference !== 0n) return difference > 0n ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  const total = sorted.reduce((sum, item) => sum + magnitude(item.cents), 0n);
  const largest = sorted.length === 0 ? 0n : magnitude(sorted[0].cents);
  return {
    bars: sorted.map((item) => ({
      ...item,
      share: total === 0n ? 0 : Number(magnitude(item.cents)) / Number(total),
      width: largest === 0n ? 0 : Number(magnitude(item.cents)) / Number(largest),
    })),
    totalCents: total,
  };
}

/** A month group's heading: the month spelled out, as in the design's group rows. */
export function monthLabel(month: MonthKey, locale: UiLocale): string {
  return formatDate(month, "monthYear", locale);
}

/**
 * The label of the date range control: one month is named, anything else is spelled out end to
 * end. The prototype makes the same distinction, and it is what keeps "September 2026" from
 * turning into "1 Sep 2026 – 30 Sep 2026" on the common case.
 */
export function rangeLabel(range: DateRange, locale: UiLocale): string {
  if (isSingleMonth(range)) return formatDate(range.from, "monthYear", locale);
  return `${formatDate(range.from, "long", locale)} – ${formatDate(range.to, "long", locale)}`;
}

/** The calendar cells of one month, Monday first, with the leading blanks of the design's grid. */
export function calendarCells(month: MonthKey): (CivilDate | null)[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const blanks = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return [
    ...Array.from({ length: blanks }, () => null),
    ...Array.from(
      { length: days },
      (_, index) => `${month.slice(0, 7)}-${String(index + 1).padStart(2, "0")}`,
    ),
  ];
}
