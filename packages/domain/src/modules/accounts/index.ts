// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export {
  accountsView,
  balancesOn,
  firstBalanceDay,
  getAccount,
  listAccounts,
  listBalanceEntries,
  listSnapshotRuns,
  movementBasis,
} from "./queries";
export type { Account } from "./queries";
export {
  ACCOUNT_TYPES,
  MANUAL_MOVEMENT_MODES,
  accountMode,
  bucketOf,
  hasIbanField,
  movementEffect,
} from "./rules";
export type { AccountMode, MovementEffect } from "./rules";
export {
  AccountError,
  accountDailyBalances,
  accountsOfProvider,
  accountsOpenToProvider,
  addConnection,
  archiveAccount,
  connectionsOf,
  createAccount,
  dailyBalancesOf,
  deleteBalanceEntry,
  ibanOwnersOf,
  linkProviderAccounts,
  rebuildDerivedBalances,
  releaseSourceAccounts,
  removeAccount,
  removeConnection,
  restoreAccount,
  restoreSourceAccounts,
  runSnapshot,
  saveBalanceEntry,
  saveProviderBalance,
  saveSourceIbans,
  snapshotMonthFor,
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
} from "./switching";
