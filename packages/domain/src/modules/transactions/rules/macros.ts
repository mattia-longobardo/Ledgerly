import type { Cents } from "../../../shared/money";
import { type CategoryType, type TransactionOrigin, type TransactionType } from "./vocabulary";

/* The macro decides how a movement counts (categories-and-rules.md §3.2, CR3) */

export interface TypedMovement {
  type: TransactionType;
  amountCents: Cents;
  origin: TransactionOrigin;
  transferGroupId: string | null;
  /** The type of the movement's category, `null` with no category. */
  categoryType: CategoryType | null;
  locallyEdited: readonly string[];
}

/**
 * The type a movement counts as, in this order: a leg of a pair keeps its type — whoever paired it
 * made it a transfer, and a leg its source re-filed leaves the pair in `linkOwnTransfers`; a
 * category of Transfers makes a transfer; a source's own transfer stays one while this
 * rule did not write it; otherwise the sign decides. A zero keeps what it was (spec §4.3), a
 * transfer excepted. `macro.ts` holds the same rule in SQL; `macro.itest.ts` keeps the two equal.
 */
export function typeByMacro(row: TypedMovement): TransactionType {
  if (row.transferGroupId !== null) return row.type;
  if (row.categoryType === "transfer") return "transfer";
  if (row.type === "transfer" && row.origin === "provider" && !row.locallyEdited.includes("type")) {
    return "transfer";
  }
  if (row.amountCents > 0n) return "income";
  if (row.amountCents < 0n) return "expense";
  return row.type === "transfer" ? "income" : row.type;
}

/**
 * `locally_edited` after {@link typeByMacro}: the `type` marker stays exactly while a category of
 * Transfers makes an unpaired movement a transfer, so the next reading does not write the sign back.
 */
export function typeMarkerByMacro(row: TypedMovement): string[] {
  const without = row.locallyEdited.filter((field) => field !== "type");
  if (row.transferGroupId !== null) return [...row.locallyEdited];
  return row.categoryType === "transfer" ? [...without, "type"].sort() : without;
}

/**
 * The macros a movement's category may be chosen in (categories-and-rules.md §3.2, QC2): a leg of
 * a pair, Transfers only; money in, Income or Transfers; money out, Expenses or Transfers.
 */
export function macrosFor(row: { amountCents: Cents; transferGroupId: string | null }): CategoryType[] {
  if (row.transferGroupId !== null) return ["transfer"];
  return row.amountCents < 0n ? ["expense", "transfer"] : ["income", "transfer"];
}
