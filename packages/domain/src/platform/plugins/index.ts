// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export {
  capabilitiesOf,
  configuredPlugins,
  credentialsStatus,
  findInstancePlugin,
  isBankPluginProvider,
  isPluginActive,
  listInstancePlugins,
  listPluginConnections,
  listUserPlugins,
  pluginDiagnostics,
  pluginManifest,
  pricesPlugin,
  rememberManifest,
} from "./queries";
export type { InstancePlugin, PluginDiagnostic } from "./queries";
export {
  AUTH_STATE_MINUTES,
  BANK_SCHEDULE,
  RATE_LIMIT_WAIT_HOURS,
  REREAD_DAYS,
  bankAccountNames,
  bankAccountType,
  hashState,
  instanceKeyOf,
  institutionOf,
  isReturnError,
  looksLikePrivateKey,
  maskIdentifier,
  movementIds,
  normalizePrivateKey,
  pickBalance,
  providerAccountIdOf,
} from "./rules";
export type { BankAccountType, ReadingError, ReturnError } from "./rules";
export { pluginActivations, pluginAuthStates, pluginUserCredentials, plugins } from "./schema";
