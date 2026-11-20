// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
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
// The source of a movement (rewrite plan R2, port of transactions until R5c), by names that are no
// provider's: `/api/v1` imports them from `@ledgerly/domain/platform/integrations/source` (rule M12).
export { walletTransactions as transactionsSource } from "./categories";
export {
  editWalletTransaction as editAtSource,
  syncWalletFor as syncSourceNow,
  walletEditableIds as editableAtSource,
} from "./records";
