import type { Cents } from "../../../shared/money";
import { type CategoryType, type TransactionOrigin, type TransactionType } from "./vocabulary";

/* What a movement counts as (categories-and-rules.md §3.2, as changed by the giroconti of 2026-11-25) */

export interface TypedMovement {
  type: TransactionType;
  amountCents: Cents;
  origin: TransactionOrigin;
  transferGroupId: string | null;
  /** The leg goes to or comes from an account outside Ledgerly ("conto esterno"). */
  transferOutside: boolean;
  locallyEdited: readonly string[];
}

/**
 * The type a movement counts as, in this order: a leg of a pair, or a leg to an account outside, is
 * a transfer; a type somebody decided here (`type` in `locally_edited`: the person, or the IBAN of
 * one of their accounts) stays; a source's own transfer, or the leg Investments wrote, stays one; otherwise the sign decides. A
 * zero keeps what it was (spec §4.3), a transfer excepted. A giroconto has no category: the
 * category never makes a transfer any more. `macro.ts` holds the same rule in SQL;
 * `macro.itest.ts` keeps the two equal.
 */
export function typeByMacro(row: TypedMovement): TransactionType {
  if (row.transferGroupId !== null || row.transferOutside) return "transfer";
  if (row.locallyEdited.includes("type")) return row.type;
  if (row.type === "transfer" && row.origin !== "manual") return "transfer";
  if (row.amountCents > 0n) return "income";
  if (row.amountCents < 0n) return "expense";
  return row.type === "transfer" ? "income" : row.type;
}

/**
 * The macros a movement's category may be chosen in: a giroconto none — it has accounts, not a
 * category —; money in, Income; money out, Expenses.
 */
export function macrosFor(row: {
  type: TransactionType;
  amountCents: Cents;
  transferGroupId: string | null;
}): CategoryType[] {
  if (row.type === "transfer" || row.transferGroupId !== null) return [];
  return row.amountCents < 0n ? ["expense"] : ["income"];
}
