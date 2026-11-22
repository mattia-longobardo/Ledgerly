// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { asAutomatic } from "./origin";
export {
  BINANCE_PROVIDER,
  ETORO_PROVIDER,
  KINDS_OF,
  PLUGIN_KINDS,
  PROVIDERS,
  TREK_PROVIDER,
  WALLET_PROVIDER,
  coreCreatesRecords,
  isKnownProvider,
  isPluginProvider,
  pluginProvider,
} from "./rules";
export type { SyncKind } from "./rules";
export { DEFAULT_SYNC_SCHEDULE, previewSchedule } from "./schedule";
export type { SyncSchedule } from "./schedule";
export {
  IntegrationError,
  SYNC_RUN_RETENTION_DAYS,
  advanceSchedule,
  anyConnectionDue,
  changeSourceSkippedIds,
  clearErrorCode,
  closeOrphanRuns,
  deleteConnection,
  deleteOldSyncRuns,
  deletedSourceAccounts,
  dueConnections,
  findConnection,
  finishRun,
  forgetSource,
  lastMovementChangeAt,
  listConnections,
  listRuns,
  makeDueNow,
  markConnection,
  readCredentials,
  readSyncJob,
  recentRuns,
  recordRun,
  rescheduleConnections,
  runningReadings,
  savePluginConnection,
  saveSchedule,
  saveSyncJob,
  skipSourceAccount,
  sourceSkippedIds,
} from "./service";
export type { Connection, DueConnection, RecentRun, SyncRun } from "./service";
export {
  clock,
  codeKey,
  daysToExpiry,
  expiryWarning,
  historyOf,
  isRunningNow,
  isSyncErrorCode,
  relativeNext,
  relativePast,
  syncStatus,
  warningFor,
} from "./status";
export type { StatusAction, StatusFacts, SyncStatus } from "./status";
export type { CardAccount, CardError, CardResult, CoreCard } from "./card";
