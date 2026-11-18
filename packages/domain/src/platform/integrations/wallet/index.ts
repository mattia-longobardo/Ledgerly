// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { deleteWalletCategories } from "./categories";
export type { WalletDeletionOutcome } from "./categories";
export { WalletError, createWalletClient, isTokenRejected, isUsableToken } from "./client";
export { BACKFILL_CHOICES, backfillDepth } from "./depth";
export {
  chooseWalletAccounts,
  isSyncBusy,
  requestWalletBackfill,
  syncWalletNow,
  walletAccountChoices,
} from "./sync";
export { WALLET_RECORD_TEXT_MAX, editWalletTransaction, walletEditableIds } from "./records";
