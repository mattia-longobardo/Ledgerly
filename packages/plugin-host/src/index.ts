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
