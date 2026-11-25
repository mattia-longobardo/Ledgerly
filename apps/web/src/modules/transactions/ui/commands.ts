/**
 * The writes the Expenses screen performs, under the names the screen calls them by, as calls to
 * `/api/v1` (rewrite plan R3). Each keeps the answer of the Server Action it replaces — a count or
 * `{ ok }`, or the code of a refusal — so the components read one shape. It is also the seam the
 * DOM tests replace, which keeps them away from the network entirely.
 */

import { TRANSACTIONS } from "@ledgerly/api-contract";
import { movements, review, spending } from "@ledgerly/api-contract/transactions";
import { categories as categoryRoutes, categoryBoard, profile } from "@ledgerly/api-contract/settings";
import { ApiError, call, type RouteInput } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";

/**
 * How many rows really changed, or the code of a refusal. The count is the route's own, not the
 * length of the list sent: a row that was already hidden is not hidden twice, and the toast says
 * what happened rather than what was asked for.
 */
export type CommandResult = { ok: true; count: number } | { ok: false; error: string };

/** One row at a time, and no count to report: what the details panel saves. */
type FieldResult = { ok: true } | { ok: false; error: string };

/** Every read that draws a movement, its category, its visibility or its amount. */
function changedMovements(): void {
  invalidate(
    movements.getTransactionsView,
    movements.listTransactions,
    movements.getTransaction,
    spending.getSpending,
    review.getReview,
  );
  // The two cards of Expenses, read by their own routes.
  invalidate(spending.getSpendingBreakdown, spending.getSpendingSeries);
  // The figures of a category's page and of the board of the categories.
  invalidate(categoryRoutes.getCategorySummary, categoryBoard.getCategoriesBoard);
}

/** The service's code: the route names it as the refusal's reason, or as the refusal itself. */
function codeOf(error: unknown): string {
  // A server fault or no answer is thrown, and the screen says the save failed.
  if (!(error instanceof ApiError) || error.status >= 500) throw error;
  return error.reason ?? error.code;
}

async function counting(work: () => Promise<{ count: number }>): Promise<CommandResult> {
  try {
    const { count } = await work();
    changedMovements();
    return { ok: true, count };
  } catch (error) {
    return { ok: false, error: codeOf(error) };
  }
}

async function writing(work: () => Promise<unknown>): Promise<FieldResult> {
  try {
    await work();
    changedMovements();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: codeOf(error) };
  }
}

/** Spec §7.2: the category is user-owned, so this also marks the rows `locally_edited`. */
export function setCategory(ids: readonly string[], categoryId: string | null): Promise<CommandResult> {
  return counting(() => call(movements.setTransactionsCategory, { body: { ids: [...ids], categoryId } }));
}

/**
 * Hide (the design's "Delete", spec §7.2 and D10: `hidden_at`, never a deletion), restore, or delete
 * a hidden row for good. The route rebuilds the balance of a manual movement's account (PERS-473).
 */
export function changeVisibility(
  ids: readonly string[],
  change: "hide" | "restore" | "delete",
): Promise<CommandResult> {
  return counting(() =>
    call(movements.changeTransactionsVisibility, { body: { ids: [...ids], change, rebuildBalances: true } }),
  );
}

/** Spec §7.2: the note is the user's. The route trims it and stores an empty one as no note (§4.3). */
export function setNote(id: string, note: string): Promise<FieldResult> {
  return writing(() => call(movements.updateTransaction, { params: { id }, body: { note } }));
}

/** Spec §7.2: the labels are the user's too, and the whole set is submitted at once. */
export function setLabels(id: string, labelIds: readonly string[]): Promise<FieldResult> {
  return writing(() =>
    call(movements.updateTransaction, { params: { id }, body: { labelIds: [...labelIds] } }),
  );
}

export interface SourceEditInput {
  type: RouteInput<typeof movements.editAtSource>["body"]["type"];
  /** As typed, in the person's number format. */
  amount: string;
  payee: string;
  note: string;
}

/**
 * `error` is a message key under `expenses.atSource.errors`; `reason` is the source's own words when it
 * refused or could not be reached, shown under the key because it is the only thing that says why.
 */
export type SourceEditResult =
  { ok: true; state: "saved" | "unchanged" } | { ok: false; error: string; reason?: string };

/** A typed amount the person's format cannot read, or zero, is no amount. */
async function decimalOf(text: string): Promise<string | null> {
  const preferences = await read(profile.getPreferences, {});
  try {
    const cents = parseAmount(text, numberStyle(preferences));
    return cents === 0n ? null : centsToDecimal(cents);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * The codes of the route and of the plugins (plugin contract 2: a code, never the source's words),
 * each under the key of the sentence the details panel shows.
 */
const SOURCE_CODES: Partial<Record<string, string>> = {
  not_linked: "notLinked",
  no_transfer_category: "noTransferCategory",
  provider_refused: "refused",
  zero_amount: "amount",
  gone: "notLinked",
};

/** The route's refusals, under the keys the details panel already shows. */
function sourceRefusal(error: unknown): SourceEditResult {
  // The source could not be reached (503): its words say why.
  if (error instanceof ApiError && error.code === "unavailable")
    return error.reason === null
      ? { ok: false, error: "failed" }
      : { ok: false, error: "failed", reason: error.reason };
  const code = codeOf(error);
  const key = SOURCE_CODES[code];
  if (key !== undefined) return { ok: false, error: key };
  // Any other reason of a conflict is the source's refusal, in its own words.
  if (error instanceof ApiError && error.code === "conflict" && error.reason !== null)
    return { ok: false, error: "refused", reason: error.reason };
  return { ok: false, error: code };
}

/**
 * A movement's type, amount, payee and note, saved to its source first and then here (owner,
 * 2026-09-24). Only offered when the row carries `atSource`, i.e. the integration is connected.
 */
export async function editInSource(id: string, input: SourceEditInput): Promise<SourceEditResult> {
  const amount = await decimalOf(input.amount);
  if (amount === null) return { ok: false, error: "amount" };
  try {
    const { state } = await call(movements.editAtSource, { params: { id }, body: { ...input, amount } });
    if (state === "saved") changedMovements();
    return { ok: true, state };
  } catch (error) {
    return sourceRefusal(error);
  }
}

/**
 * The giroconti's calls. shortcut: read from the contract's root, because its `transactions` entry
 * does not export `giroconti` yet; import them from there once it does.
 */
export const { giroconti } = TRANSACTIONS;

/** The other side of a giroconto: one of the person's accounts, an account outside, or none (an income or a spending again). */
export type TransferSide = RouteInput<typeof giroconti.setTransferSide>["body"];

export function setTransferSide(id: string, side: TransferSide): Promise<FieldResult> {
  return writing(async () => {
    await call(giroconti.setTransferSide, { params: { id }, body: side });
    invalidate(giroconti.listTransferProposals);
  });
}

/** Two movements of two of the person's accounts, money out and money in, paired by hand. */
export function pairTransfer(ids: readonly [string, string]): Promise<FieldResult> {
  return writing(async () => {
    await call(giroconti.pairTransfer, { body: { ids: [...ids] } });
    invalidate(giroconti.listTransferProposals);
  });
}

/** The person's answer to a giroconto found by amount and day. */
export function answerTransferProposal(id: string, accept: boolean): Promise<FieldResult> {
  return writing(async () => {
    await call(giroconti.answerTransferProposal, { params: { id }, body: { accept } });
    invalidate(giroconti.listTransferProposals);
  });
}
