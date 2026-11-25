// Transactions · the markers of a row (spec §7.2): a pure rule, so the Expenses pages and
// `/api/v1` give a movement the same badges.
import type { TransactionOrigin, TransactionState, TransactionType } from "./vocabulary";

/**
 * The markers of spec §7.2, in the order the row shows them. `unpaired` takes the place of
 * `transfer` on a giroconto that waits for the person ("Scegli il conto", decision 9A): no other
 * leg here, no account named, not to an account outside. It is still not spending.
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
  /** The other side of a giroconto, when it is outside or an account is named. */
  transferOutside?: boolean;
  transferAccountId?: string | null;
}

/**
 * "Edited here": a row left what its provider gave. Not a category chosen where the source gives
 * none — there is no category of the source it moved away from (ux/n3-categories-manual.md §2.3) —,
 * nor a giroconto decided here (`type`, a pair by hand): its own badges say it already.
 */
function editedHere(row: BadgeSource): boolean {
  return row.locallyEdited.some(
    (field) =>
      field !== "type" &&
      field !== "transferGroupId" &&
      !(row.categoryIsOwn === true && field === "categoryId"),
  );
}

/** A giroconto's badge: `unpaired` while it waits for the person, else `transfer`. */
function transferBadge(row: BadgeSource): RowBadge | null {
  if (row.type !== "transfer") return row.transferGroupId !== null ? "transfer" : null;
  const waiting = row.transferGroupId === null && row.transferOutside !== true && !row.transferAccountId;
  return waiting ? "unpaired" : "transfer";
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
  if (editedHere(row) && !manual) badges.push("edited");
  const transfer = transferBadge(row);
  if (transfer !== null) badges.push(transfer);
  if (row.state === "pending") badges.push("pending");
  return badges;
}
