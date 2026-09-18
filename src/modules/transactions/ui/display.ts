/**
 * What the Expenses screen shows, decided away from the markup: the badges a row carries, the
 * colour a category is drawn in, the bars of the "By category" card and the label of a date
 * range. Pure functions, unit-tested, so the components stay layout and nothing else.
 */

import { PALETTE } from "@/modules/accounts/ui/display";
import type { TransactionState, TransactionType } from "@/modules/transactions/rules";
import type { MonthKey } from "@/platform/dates";
import { formatDate, type UiLocale } from "@/platform/format";
import type { Cents } from "@/platform/money";
import { type Tone, toneOfSign } from "@/ui/tone";
import { type DateRange, isSingleMonth } from "./filters";

/** A category's own colour wins; the ones without get a stable one from the shared palette. */
export function categoryColor(color: string | null, index: number): string {
  return color ?? PALETTE[index % PALETTE.length];
}

/**
 * The markers of spec §7.2, in the order the row shows them. `unpaired` takes the place of
 * `transfer` on a giroconto with no other leg here (F2.5): it is still not spending, but it usually
 * means the other account is not linked.
 */
export const ROW_BADGES = ["hidden", "removedUpstream", "edited", "transfer", "unpaired", "pending"] as const;

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
  if (row.type === "transfer" && row.transferGroupId === null) badges.push("unpaired");
  else if (row.type === "transfer" || row.transferGroupId !== null) badges.push("transfer");
  if (row.state === "pending") badges.push("pending");
  return badges;
}

/**
 * The colour of a movement's amount: red out, green in — except a giroconto, which is grey both
 * ways, because moving money between two of one's own accounts is neither spending nor income
 * (spec §7.2), and a red leg read exactly like the expense it is not.
 */
export function amountToneOf(row: { type: TransactionType; amountCents: Cents }): Tone {
  return row.type === "transfer" ? "muted" : toneOfSign(row.amountCents);
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

/** A slice of the card with its group (F2.5), colours already decided by the page. */
export interface BreakdownSlice extends BreakdownInput {
  parentId: string | null;
  parentName: string | null;
  parentColor: string | null;
}

/** A group of the card: its own bar, and its sub-categories' bars measured within it. */
export interface BreakdownGroup extends BreakdownBar {
  children: BreakdownBar[];
}

/**
 * The "By category" card on two levels (spec §7.2, F2.5): one bar per group, biggest first, each
 * holding its sub-categories. A group's amount is its children's plus whatever was filed on the
 * group itself, which then shows as one of its rows under the group's own name. A category with no
 * group is a group with no rows under it, so a range without groups draws the card it always did.
 *
 * Both levels are measured by `categoryBreakdown`: groups against the whole range, children against
 * their group, so the percentages read "of Casa" once inside Casa.
 */
export function groupedBreakdown(slices: readonly BreakdownSlice[]): {
  groups: BreakdownGroup[];
  totalCents: Cents;
} {
  const gathered = new Map<
    string,
    { head: BreakdownInput; own: BreakdownInput | null; children: BreakdownInput[] }
  >();
  for (const slice of slices) {
    const item: BreakdownInput = { id: slice.id, name: slice.name, color: slice.color, cents: slice.cents };
    const groupId = slice.parentId ?? slice.id;
    const entry = gathered.get(groupId) ?? {
      head:
        slice.parentId === null
          ? { ...item, cents: 0n }
          : {
              id: slice.parentId,
              name: slice.parentName ?? slice.name,
              color: slice.parentColor ?? slice.color,
              cents: 0n,
            },
      own: null,
      children: [],
    };
    if (slice.parentId === null) {
      entry.own = item;
      entry.head = { ...item, cents: 0n };
    } else {
      entry.children.push(item);
    }
    gathered.set(groupId, entry);
  }

  const top = categoryBreakdown(
    [...gathered.values()].map(({ head, own, children }) => ({
      ...head,
      cents: children.reduce((sum, child) => sum + child.cents, own?.cents ?? 0n),
    })),
  );
  return {
    groups: top.bars.map((bar) => {
      const entry = gathered.get(bar.id);
      const rows =
        entry && entry.children.length > 0 ? [...entry.children, ...(entry.own ? [entry.own] : [])] : [];
      return { ...bar, children: rows.length === 0 ? [] : categoryBreakdown(rows).bars };
    }),
    totalCents: top.totalCents,
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
