// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export {
  accountNames,
  accountOptions,
  accountsView,
  balanceDays,
  readingsAt,
  firstBalanceDay,
  getAccount,
  listAccounts,
  listBalanceEntries,
  listSnapshotRuns,
  movementBasis,
  requireOpenAccount,
} from "./queries";
export type { Account } from "./queries";
export {
  ACCOUNT_TYPES,
  MANUAL_MOVEMENT_MODES,
  SOURCE_PRECEDENCE,
  accountMode,
  bucketOf,
  hasIbanField,
  isFutureDate,
  movementEffect,
} from "./rules";
export type { AccountMode, MovementEffect } from "./rules";
export {
  AccountError,
  accountReconstructedBalances,
  accountsOfProvider,
  accountsOpenToProvider,
  addConnection,
  archiveAccount,
  connectionsOf,
  createAccount,
  reconstructedBalances,
  deleteBalanceEntry,
  ibanOwnersOf,
  linkProviderAccounts,
  openedNoLaterThan,
  rebuildDerivedBalances,
  releaseSourceAccounts,
  removeAccount,
  removeConnection,
  replacePortfolioPoints,
  restoreAccount,
  restoreSourceAccounts,
  runSnapshot,
  saveBalanceEntry,
  saveProviderBalance,
  saveSourceIbans,
  snapshotMonthFor,
  takeOverEntries,
  updateAccountSettings,
  updateBalanceEntry,
  updateConnection,
} from "./service";
export type { ConnectionInput } from "./service";
export {
  addSwitchCounts,
  closeSwitch,
  lastSourceBalance,
  openSwitchOf,
  openSwitches,
  recordSwitch,
} from "./service/switching";
export { wireAccounts } from "./ports";
