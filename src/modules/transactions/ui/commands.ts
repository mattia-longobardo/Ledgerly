/**
 * The three writes the Expenses screen performs, under the names the screen calls them by.
 *
 * `modules/transactions/actions.ts` belongs to T5; this file is the only place that names its
 * exports, so a renamed Server Action is one import to fix instead of a component rewrite. It is
 * also the seam the DOM tests replace, which keeps them away from the server entirely.
 */

import {
  type ActionResult,
  type CountResult,
  deleteHiddenTransactionsAction,
  hideTransactionsAction,
  restoreTransactionsAction,
  setTransactionCategoryAction,
  setTransactionLabelsAction,
  setTransactionNoteAction,
} from "@/modules/transactions/actions";

/**
 * How many rows really changed, or the code of a refusal. The count is the action's own, not the
 * length of the list sent: a row that was already hidden is not hidden twice, and the toast says
 * what happened rather than what was asked for.
 */
export type CommandResult = CountResult;

/** Spec §7.2: the category is user-owned, so this also marks the rows `locally_edited`. */
export function setCategory(ids: readonly string[], categoryId: string | null): Promise<CommandResult> {
  return setTransactionCategoryAction([...ids], categoryId);
}

/** Spec §7.2 and D10: the design's "Delete" is this — `hidden_at`, never a deletion. */
export function hide(ids: readonly string[]): Promise<CommandResult> {
  return hideTransactionsAction([...ids]);
}

/** What "Show hidden" is for: bringing a hidden row back into the totals (spec §7.2). */
export function restore(ids: readonly string[]): Promise<CommandResult> {
  return restoreTransactionsAction([...ids]);
}

/** "Delete" under "Restore": only for hidden rows, and for good. */
export function removeHidden(ids: readonly string[]): Promise<CommandResult> {
  return deleteHiddenTransactionsAction([...ids]);
}

/** One row at a time, and no count to report: what the details panel saves. */
export type FieldResult = ActionResult;

/** Spec §7.2: the note is the user's. An empty one is stored as no note at all (§4.3). */
export function setNote(id: string, note: string): Promise<FieldResult> {
  return setTransactionNoteAction(id, note);
}

/** Spec §7.2: the labels are the user's too, and the whole set is submitted at once. */
export function setLabels(id: string, labelIds: readonly string[]): Promise<FieldResult> {
  return setTransactionLabelsAction(id, [...labelIds]);
}
