/**
 * What the Expenses screen shows, decided away from the markup: the badges a row carries, the
 * colour a category is drawn in, the bars of the "By category" card and the label of a date
 * range. Pure functions, unit-tested, so the components stay layout and nothing else.
 */

import { PALETTE } from "@ledgerly/design-tokens";
import type {
  TransactionOrigin,
  TransactionState,
  TransactionType,
} from "@ledgerly/domain/transactions/client";
import type { MonthKey } from "@ledgerly/domain/shared/dates";
import { formatDate, type UiLocale } from "@ledgerly/domain/platform/format";
import type { Cents } from "@ledgerly/domain/shared/money";
import { type Tone, toneOfSign } from "@ledgerly/ui/tone";

/** A category's own colour wins; the ones without get a stable one from the shared palette. */
export function categoryColor(color: string | null, index: number): string {
  return color ?? PALETTE[index % PALETTE.length];
}

/**
 * The colour every category is drawn in, decided once for the whole screen: a group's own colour,
 * or one from the palette counted by group; and a sub-category **always** in its group's colour, so
 * a group and its children read as one family in the table, the menus and the card. A sub-category
 * whose group is not in the list (archived) keeps a colour of its own.
 */
export function categoryColors(
  categories: readonly { id: string; parentId: string | null; color: string | null }[],
): Map<string, string> {
  const present = new Set(categories.map((category) => category.id));
  const colors = new Map<string, string>();
  let groups = 0;
  for (const category of categories) {
    if (category.parentId !== null && present.has(category.parentId)) continue;
    colors.set(category.id, categoryColor(category.color, groups));
    groups += 1;
  }
  for (const category of categories) {
    if (category.parentId === null || !present.has(category.parentId)) continue;
    colors.set(category.id, colors.get(category.parentId) as string);
  }
  return colors;
}

/**
 * The markers of spec §7.2, in the order the row shows them. `unpaired` takes the place of
 * `transfer` on a giroconto with no other leg here (F2.5): it is still not spending, but it usually
 * means the other account is not linked.
 */

export type RowBadge =
  "manual" | "hidden" | "removedUpstream" | "edited" | "transfer" | "unpaired" | "pending";

export interface BadgeSource {
  hiddenAt: Date | null;
  removedUpstreamAt: Date | null;
  locallyEdited: readonly string[];
  type: TransactionType;
  transferGroupId: string | null;
  state: TransactionState;
  /** Left out for a row read before the origin existed: a provider's. */
  origin?: TransactionOrigin;
  /** Whether the movement's source gives no category (`TransactionRow.categoryIsOwn`). */
  categoryIsOwn?: boolean;
}

/**
 * Why a row does not simply count (spec §7.2). "Hidden" and "gone from the provider" are two
 * different facts even though both keep the row out of the totals: one is a decision of the
 * person, the other one of Wallet, and only the first is theirs to undo.
 */
export function badgesOf(row: BadgeSource): RowBadge[] {
  const badges: RowBadge[] = [];
  const manual = row.origin === "manual";
  if (manual) badges.push("manual");
  if (row.hiddenAt !== null) badges.push("hidden");
  if (row.removedUpstreamAt !== null) badges.push("removedUpstream");
  // "Edited here" says a row left what its provider gave: a manual movement has no provider.
  // Nor does a category chosen where the source gives none: there is no category of the source
  // the movement moved away from (ux/n3-categories-manual.md §2.3).
  const edited = row.categoryIsOwn
    ? row.locallyEdited.filter((field) => field !== "categoryId")
    : row.locallyEdited;
  if (edited.length > 0 && !manual) badges.push("edited");
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

/** A month group's heading: the month spelled out, as in the design's group rows. */
export function monthLabel(month: MonthKey, locale: UiLocale): string {
  return formatDate(month, "monthYear", locale);
}

/**
 * The options of a category picker under the title of their macro (categories-and-rules.md §2.4,
 * N3.2): Income, Expenses, Transfers, in this order, each in its tree order. A sub-category has its
 * group's type, so a group never leaves its children.
 */
export function withMacroTitles<T extends { type: "income" | "expense" | "transfer" }>(
  options: readonly T[],
  titles: Record<"income" | "expense" | "transfer", string>,
): (T & { section: string })[] {
  const order = ["income", "expense", "transfer"] as const;
  return order.flatMap((type) =>
    options.filter((option) => option.type === type).map((option) => ({ ...option, section: titles[type] })),
  );
}
