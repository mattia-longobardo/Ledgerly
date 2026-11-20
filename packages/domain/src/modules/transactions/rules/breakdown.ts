// Transactions · the "By category" card and the spending chart as numbers (spec §7.2, F2.5): pure
// rules, so the Expenses pages and `/api/v1` measure the same bars and the same bands (PERS-473).
import { addDays, type CivilDate, monthKey, monthsBetween } from "../../../shared/dates";
import { type Cents, share } from "../../../shared/money";

interface BreakdownInput {
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
interface Breakdown {
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
    .sort((left, right) => {
      const difference = magnitude(right.cents) - magnitude(left.cents);
      if (difference !== 0n) return difference > 0n ? 1 : -1;
      return left.name.localeCompare(right.name);
    });
  const total = sorted.reduce((sum, item) => sum + magnitude(item.cents), 0n);
  const largest = sorted.length === 0 ? 0n : magnitude(sorted[0].cents);
  return {
    bars: sorted.map((item) => ({
      ...item,
      share: share(magnitude(item.cents), total) ?? 0,
      width: share(magnitude(item.cents), largest) ?? 0,
    })),
    totalCents: total,
  };
}

/** A slice of the card with its group (F2.5), colours already decided by the page. */
interface BreakdownSlice extends BreakdownInput {
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

/**
 * The spending chart's bands (F2.5): one series per group of categories with a value for every
 * bucket — zero where it spent nothing, because spending nothing is a known amount — the biggest
 * spender first (it goes at the bottom of the pile), and the total of each bucket. A point outside
 * the buckets (a day past today) is left out; a group that spent nothing in them has no band.
 */
export function spendingLayers(
  points: readonly { bucket: string; groupId: string | null; cents: Cents }[],
  buckets: readonly string[],
): { groups: { id: string | null; values: Cents[]; total: Cents }[]; totals: Cents[] } {
  const position = new Map(buckets.map((bucket, index) => [bucket, index]));
  const byGroup = new Map<string | null, Cents[]>();
  for (const point of points) {
    const index = position.get(point.bucket);
    if (index === undefined) continue;
    const values = byGroup.get(point.groupId) ?? buckets.map(() => 0n);
    values[index] += point.cents;
    byGroup.set(point.groupId, values);
  }
  const groups = [...byGroup.entries()]
    .map(([id, values]) => ({ id, values, total: values.reduce((sum, value) => sum + value, 0n) }))
    .sort((left, right) => {
      const difference = right.total - left.total;
      if (difference !== 0n) return difference > 0n ? 1 : -1;
      return (left.id ?? "").localeCompare(right.id ?? "");
    });
  const totals = buckets.map((_bucket, index) =>
    groups.reduce((sum, group) => sum + group.values[index], 0n),
  );
  return { groups, totals };
}

/**
 * The steps of the spending chart (F2.5): every day, or every month, from the start of the range to
 * today at the latest — a day that has not happened spent nothing, and drawing it as zero would
 * read as a quiet day.
 */
export function spendingBuckets(
  range: { from: CivilDate; to: CivilDate },
  grain: "day" | "month",
  today: CivilDate,
): string[] {
  const lastDay = range.to < today ? range.to : today;
  const buckets: string[] = [];
  if (grain === "day") {
    for (let day = range.from; day <= lastDay; day = addDays(day, 1)) buckets.push(day);
  } else if (range.from <= lastDay) {
    buckets.push(...monthsBetween(monthKey(range.from), monthKey(lastDay)));
  }
  return buckets;
}

/** How many movements «To review» holds, groups and single movements, and their amount. */
export function reviewTotals(review: {
  suggested: readonly { count: number; totalCents: Cents }[];
  unsuggested: readonly { count: number; totalCents: Cents }[];
  singles: readonly { amountCents: Cents }[];
}): { count: number; totalCents: Cents } {
  const groups = [...review.suggested, ...review.unsuggested];
  return {
    count: groups.reduce((sum, group) => sum + group.count, 0) + review.singles.length,
    totalCents:
      groups.reduce((sum, group) => sum + group.totalCents, 0n) +
      review.singles.reduce((sum, row) => sum + row.amountCents, 0n),
  };
}

/**
 * The count of a group's chip (F2.5): the group's own movements and its sub-categories', for every
 * group that has sub-categories and any movement. `counts` are the categories' own (`facetCounts`).
 */
export function groupCounts(
  categories: readonly { id: string; parentId: string | null; depth: number }[],
  counts: readonly { categoryId: string | null; count: number }[],
): { categoryId: string; count: number }[] {
  const own = new Map(counts.map((facet) => [facet.categoryId, facet.count]));
  const groups = new Map<string, number>();
  for (const category of categories) {
    if (category.parentId === null || category.depth === 0) continue;
    const sum = groups.get(category.parentId) ?? own.get(category.parentId) ?? 0;
    groups.set(category.parentId, sum + (own.get(category.id) ?? 0));
  }
  return [...groups.entries()]
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([categoryId, count]) => ({ categoryId, count }));
}
