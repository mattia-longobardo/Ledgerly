// modules/transactions/service.ts — the use cases of spec §7.2: the provider upsert, the local
// edits that outrank it, and visibility.
//
// Every decision belongs to `rules.ts`; this file only resolves the ids those rules need — the
// account, the category, the labels — and writes what they hand back. There is no network call
// anywhere here (spec §4.3): the movements arrive already fetched, and the sync engine that
// fetched them is outside.
export {
  TransactionError,
  requireTransaction,
  requireOwnCategory,
  requireMovementAccount,
  chosenBy,
  categorisableAccountIds,
  ruleAccountFacts,
} from "./guards";
export { upsertFromProvider } from "./provider";
export {
  linkOwnTransfers,
  chooseTransferSide,
  pairByHand,
  listTransferProposals,
  answerTransferProposal,
  transferSideSchema,
} from "./giroconti";
export type { TransferSide, TransferProposal } from "./giroconti";
export { settleLegs, writeLegs } from "./legs";
export {
  updateTransaction,
  releaseLocalEdits,
  setCategory,
  hideTransaction,
  hideTransactions,
  restoreTransactions,
  deleteHiddenTransactions,
  purgeRemovedUpstream,
  markRemovedUpstream,
  clearRemovedUpstream,
} from "./edits";
export {
  CATEGORY_NAME_MAX,
  listProviderCategories,
  adoptProviderCategory,
  followProviderCategoryName,
  settleProviderCategoryName,
  linkProviderCategory,
} from "./provider-categories";
export type { ProviderCategory } from "./provider-categories";
export { markNotSent, pendingSends, settleSent } from "../sending";
export { recordSourceCategories, sourceCategoryFor } from "../source-categories";
