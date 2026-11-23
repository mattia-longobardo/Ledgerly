// Transactions · the markers of a row (spec §7.2): a pure rule, so the Expenses pages and
// `/api/v1` give a movement the same badges.
import type { TransactionOrigin, TransactionState, TransactionType } from "./vocabulary";

/**
 * The markers of spec §7.2, in the order the row shows them. `unpaired` takes the place of
 * `transfer` on a giroconto with no other leg here (F2.5): it is still not spending, but it usually
 * means the other account is not linked.
 */

export const ROW_BADGES = [
  "manual",
  "hidden",
  "removedUpstream",
  "edited",
  "transfer",
  "unpaired",
  "pending",
] as const;
export type RowBadge = (typeof ROW_BADGES)[number];

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
 * person, the other one of the source, and only the first is theirs to undo.
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
