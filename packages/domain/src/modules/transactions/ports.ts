// The ports of transactions. Out: the adapter of the port `MovementsPort` of accounts (audit
// ACC-8), what accounts reads of the movements, realised here; the application wires it
// (`wireDomain`). In: `TransactionsProvider` (audit TRX-6), what a source of movements gives.
import type { Ctx } from "../../platform/context";
import { duplicatesOf, markDuplicate, twinOf } from "./service/duplicates";
import { dailyNetByAccount, manualMovementsByAccount, transactionIdsOfAccount } from "./queries/movements";
import { linkOwnTransfers } from "./service/giroconti";
import { settleLegs, writeLegs } from "./service/legs";
import { twinAccountsOf } from "./service/twins";

export const movementsOfAccounts = {
  dailyNetByAccount,
  manualMovementsByAccount,
  transactionIdsOfAccount,
  twinAccountsOf,
  linkOwnTransfers,
  twinOf,
  markDuplicate,
  duplicatesOf,
};

/**
 * The adapter of the ports `CashLegs` of investments and funds (PERS-651): the account's leg of a
 * deposit, a withdrawal or a voluntary contribution, written and paired here.
 */
export const cashLegsOfTransactions = { writeLegs, settleLegs };

/**
 * A source of movements as transactions sees it (audit TRX-6): the provider id its movements and
 * categories are linked under (`provider_links`), and the deletion at the source that a local
 * category deletion is mirrored to. Each source realises it in its own folder; the caller picks one
 * and passes it, so the module names no provider and has no default.
 */
export interface TransactionsProvider<Deletion = unknown> {
  readonly provider: string;
  /** Deletes the categories with these external ids at the source; the caller reports the outcome. */
  deleteCategories(ctx: Pick<Ctx, "userId">, externalIds: readonly string[]): Promise<Deletion>;
}
