/**
 * What the manual movement's components are handed (rewrite plan, ux/n3-categories-manual.md §9).
 * The writes and the reads are passed in by the page: they join two modules, so they are Server
 * Actions of the application and no component of this module imports them.
 */
import type { ManualKind } from "../manual-rules";
import type { CommandResult } from "./commands";

export type { ManualKind };

/** An account the dialog offers. `mode` decides the group it is listed in and the notes under it. */
export interface ManualAccountView {
  id: string;
  name: string;
  currency: string;
  mode: "manual" | "two_way" | "read_only";
}

/** The fields of the dialog, as typed: the amount in the person's own number format. */
export interface ManualForm {
  kind: ManualKind;
  amount: string;
  /** A civil date, `YYYY-MM-DD`. */
  on: string;
  accountId: string;
  categoryId: string | null;
  payee: string;
  note: string;
}

export type ManualSaveResult =
  | { ok: true; created: boolean; id: string; on: string; date: string; accountId: string }
  | { ok: false; error: "amount" | "date" | "account" | "notFound" | "failed" };

/** The line under the account: today's balance before and after, already formatted. */
export type ManualPreviewView =
  | { kind: "change"; account: string; before: string; after: string }
  | { kind: "unchanged"; account: string; date: string }
  | null;

export interface ManualCommands {
  /** What the dialog reads when it opens. */
  form(): Promise<{ accounts: ManualAccountView[]; today: string }>;
  preview(
    input: Pick<ManualForm, "kind" | "amount" | "on" | "accountId"> & { editingId?: string },
  ): Promise<ManualPreviewView>;
  /** `key` is made once for each opening of the dialog: sent twice, it writes once. */
  create(input: ManualForm, key: string): Promise<ManualSaveResult>;
  update(id: string, input: ManualForm): Promise<ManualSaveResult>;
  remove(id: string): Promise<CommandResult>;
  /** Hide, restore and delete of a selection, with the balance of a manual movement kept right. */
  visibility(ids: string[], change: "hide" | "restore" | "delete"): Promise<CommandResult>;
}

/** What the page says about the list on screen, to tell whether a new movement is in it. */
export interface ShownRange {
  from: string;
  to: string;
  /** The accounts the list is narrowed to; empty for all of them. */
  accountIds: readonly string[];
  /** Whether a filter other than the range and the accounts is on. */
  narrowed: boolean;
}

/** The fields of a manual movement the dialog prefills when the row is changed. */
export interface ManualFieldsView {
  kind: ManualKind;
  /** The size of the amount, in the person's number format. */
  amount: string;
  on: string;
  accountId: string;
  /** The payee as written, not the name the table shows for a missing one. */
  payee: string;
}
