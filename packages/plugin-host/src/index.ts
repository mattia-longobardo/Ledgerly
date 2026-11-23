// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { SinkRefusal } from "./ports";
export type { BankSink, ReadingMovement } from "./ports";
export {
  PluginActionError,
  completeAccess,
  connectionSharing,
  connectionSummary,
  disconnectBank,
  forgetPlugin,
  keepManifestsFresh,
  listInstitutions,
  prepareAccessClosing,
  removeUserCredentials,
  returnAddress,
  saveUserCredentials,
  setPluginActive,
  startAccess,
} from "./service";
export type { Deps, PluginActionCode, Presence, ReturnOutcome } from "./service";
export { pluginPriceSource } from "./prices";
export { chooseAccounts, exposedAccounts, previewBankAccount, readBank, runBankPass, tieBack } from "./sync";
export type { AccountDecision } from "./sync";
export { openSource } from "./source";
export { openCalendar } from "./calendar";
// The engines of a source read with a token and of a leave calendar (rewrite plan R5c, P3b).
export { cardOf, historyOf } from "./cards";
export type { CardAccount, CardError, CardResult, PluginCard } from "./card";
export { connectionsThatCan, providerCan } from "./capabilities";
export { wireSinks } from "./sinks";
export type { MovementsSink } from "./movements/ports";
export { wireSource } from "./movements/calls";
export { isSyncBusy, syncSourceNow } from "./movements/sync";
export { editAtSource, editableAtSource, syncSourceFor } from "./movements/records";
export { categorySourceOf } from "./movements/categories";
export type { LeaveSink } from "./leave/ports";
export { wireCalendar } from "./leave/calls";
export { leaveCalendar } from "./leave/port";
