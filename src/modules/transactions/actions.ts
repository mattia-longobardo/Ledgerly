// src/modules/transactions/actions.ts — the Expenses Server Actions (spec §4.2): validate →
// service → revalidate, and nothing else. Only the fields §7.2 calls local travel through here;
// payee, amount and date have no action of their own; with Wallet connected they travel together
// through `editWalletTransactionAction`, which writes them to Wallet before writing them here.
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseAmount } from "@/modules/accounts/rules";
import { requireSession } from "@/platform/auth/session";
import { WALLET_RECORD_TEXT_MAX, editWalletTransaction } from "@/platform/integrations/wallet/records";
import { TRANSACTION_TYPES } from "./rules";
import { searchPayees } from "./queries";
import {
  TransactionError,
  deleteHiddenTransactions,
  hideTransactions,
  restoreTransactions,
  setCategory,
  updateTransaction,
} from "./service";

/**
 * Forms call these inside a transition with no error boundary, so a refusal comes back as a
 * message key under the calling component's namespace rather than throwing (as in accounts).
 */
export type ActionResult = { ok: true } | { ok: false; error: string };
/** The multiple actions answer with how many rows they really changed, for the toast. */
export type CountResult = { ok: true; count: number } | { ok: false; error: string };

function failed(error: unknown): { ok: false; error: string } {
  if (error instanceof TransactionError) return { ok: false, error: error.code };
  if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
  throw error;
}

const idsSchema = z.array(z.uuid()).min(1).max(500);

export async function setTransactionCategoryAction(
  ids: string[],
  categoryId: string | null,
): Promise<CountResult> {
  const ctx = await requireSession();
  try {
    const count = await setCategory(ctx, idsSchema.parse(ids), categoryId);
    revalidatePath("/expenses");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

/** A note is stored trimmed, and an empty note is no note at all (spec §4.3). */
export async function setTransactionNoteAction(id: string, note: string): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const trimmed = note.trim();
    await updateTransaction(ctx, id, { note: trimmed === "" ? null : trimmed });
    revalidatePath("/expenses");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

export async function setTransactionLabelsAction(id: string, labelIds: string[]): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    await updateTransaction(ctx, id, { labelIds: z.array(z.uuid()).max(50).parse(labelIds) });
    revalidatePath("/expenses");
    return { ok: true };
  } catch (error) {
    return failed(error);
  }
}

/** "Hide" — the design's "Delete" (spec §7.2, D10). The rows stay and can be restored. */
export async function hideTransactionsAction(ids: string[]): Promise<CountResult> {
  const ctx = await requireSession();
  try {
    const count = await hideTransactions(ctx, idsSchema.parse(ids));
    revalidatePath("/expenses");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

export async function restoreTransactionsAction(ids: string[]): Promise<CountResult> {
  const ctx = await requireSession();
  try {
    const count = await restoreTransactions(ctx, idsSchema.parse(ids));
    revalidatePath("/expenses");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

/** "Delete" on hidden rows: gone for good, and a synced one is never imported again. */
export async function deleteHiddenTransactionsAction(ids: string[]): Promise<CountResult> {
  const ctx = await requireSession();
  try {
    const count = await deleteHiddenTransactions(ctx, idsSchema.parse(ids));
    revalidatePath("/expenses");
    revalidatePath("/");
    return { ok: true, count };
  } catch (error) {
    return failed(error);
  }
}

/**
 * The payees of the ⌘K palette (spec §7.2). A read, not a write: it revalidates nothing, and a
 * malformed term answers with an empty list rather than an error a palette cannot show.
 */
export async function searchPayeesAction(
  query: string,
  limit?: number,
): Promise<{ payee: string; count: number }[]> {
  const ctx = await requireSession();
  const term = z.string().max(200).safeParse(query);
  if (!term.success) return [];
  return searchPayees(ctx, term.data, limit);
}

const editSchema = z.object({
  type: z.enum(TRANSACTION_TYPES),
  amount: z.string().max(40),
  payee: z.string().max(WALLET_RECORD_TEXT_MAX),
  note: z.string().max(WALLET_RECORD_TEXT_MAX),
});

export type WalletEditInput = z.input<typeof editSchema>;

/**
 * `error` is a message key under `expenses.wallet.errors`; `reason` is Wallet's own words when it
 * refused or could not be reached, shown under the key because it is the only thing that says why.
 */
export type WalletEditResult =
  { ok: true; state: "saved" | "unchanged" } | { ok: false; error: string; reason?: string };

/** Type, amount, payee and note of a Wallet movement, written to Wallet first and then here. */
export async function editWalletTransactionAction(
  id: string,
  input: WalletEditInput,
): Promise<WalletEditResult> {
  const ctx = await requireSession();
  const parsed = editSchema.safeParse(input);
  if (!z.uuid().safeParse(id).success || !parsed.success) return { ok: false, error: "invalid" };

  let amountCents: bigint;
  try {
    amountCents = parseAmount(parsed.data.amount, ctx.numberFormat);
  } catch {
    return { ok: false, error: "amount" };
  }
  if (amountCents === 0n) return { ok: false, error: "amount" };

  const outcome = await editWalletTransaction(ctx, id, {
    type: parsed.data.type,
    amountCents,
    payee: parsed.data.payee,
    note: parsed.data.note,
  });
  switch (outcome.state) {
    case "saved":
      revalidatePath("/expenses");
      revalidatePath("/");
      return { ok: true, state: "saved" };
    case "unchanged":
      return { ok: true, state: "unchanged" };
    case "not_linked":
      return { ok: false, error: "notLinked" };
    case "refused":
      if (outcome.reason === "no_transfer_category") return { ok: false, error: "noTransferCategory" };
      return { ok: false, error: "refused", reason: outcome.reason };
    case "failed":
      return { ok: false, error: "failed", reason: outcome.reason };
  }
}
