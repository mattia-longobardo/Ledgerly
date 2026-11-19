// The public interface of the wire's contract (10-modularity.md §10.2, rule M7).
export { civilDate } from "./primitives";
export { API_ERRORS } from "./errors";
export type { ApiErrorCode } from "./errors";
export { CONTRACT_SCOPES } from "./scopes";
export type { ContractScope } from "./scopes";
export type { RouteContract } from "./route";
export { API_LEVEL, MIN_CLIENT_LEVEL, metaRoute } from "./meta";
export { openApiDocument } from "./openapi";
export {
  ACCOUNTS,
  ACCOUNTS_ROUTES,
  CONTRACT_ROUTES,
  SETTINGS,
  SETTINGS_ROUTES,
  TRANSACTIONS,
  TRANSACTIONS_ROUTES,
} from "./routes";
export {
  LAST_DAY,
  MAX_RULES,
  MAX_TIMES,
  MIN_SYNC_GAP_MINUTES,
  SCHEDULE_PREVIEW_COUNT,
  syncRuleSchema,
  syncScheduleSchema,
} from "./settings/schedule";
export { CONNECTION_REFUSALS } from "./settings/shared";
export { searchRecords } from "./search";
export { SESSION_CSRF_HEADER } from "./session";
