// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export {
  PLUGIN_PATHS,
  SECRET_HEADER,
  accountSchema,
  authCompleteRequestSchema,
  authCompleteResponseSchema,
  authRevokeRequestSchema,
  authRevokeResponseSchema,
  authStartRequestSchema,
  authStartResponseSchema,
  institutionsRequestSchema,
  institutionsResponseSchema,
  pricesRequestSchema,
  pricesResponseSchema,
  syncRequestSchema,
  syncResponseSchema,
  verifyRequestSchema,
  verifyResponseSchema,
} from "./calls";
export type {
  AuthCompleteResponse,
  AuthStartResponse,
  InstitutionsResponse,
  PluginAccount,
  PluginTransaction,
  PricesResponse,
  SyncResponse,
  VerifyResponse,
} from "./calls";
export {
  SOURCE_PATHS,
  editRequestSchema,
  editResponseSchema,
  pushRequestSchema,
  pushResponseSchema,
  sourceAccountsRequestSchema,
  sourceAccountsResponseSchema,
  sourceCategoriesRequestSchema,
  sourceCategoriesResponseSchema,
  sourceMovementsRequestSchema,
  sourceMovementsResponseSchema,
  sourceRecordRequestSchema,
  sourceRecordResponseSchema,
  writeCategoriesRequestSchema,
  writeCategoriesResponseSchema,
} from "./calls-source";
export type {
  EditResponse,
  PushResponse,
  SourceAccountsResponse,
  SourceCategoriesResponse,
  SourceMovement,
  SourceMovementsResponse,
  SourceRecordResponse,
  WriteCategoriesResponse,
} from "./calls-source";
export { PLUGIN_ERROR_STATUS, errorBodySchema } from "./errors";
export type { PluginErrorBody, PluginErrorCode } from "./errors";
export { PLUGIN_ID, acceptsContract, hasCapability, manifestSchema } from "./manifest";
export type { PluginManifest } from "./manifest";
export {
  CALENDAR_PATHS,
  leaveFiguresRequestSchema,
  leaveReadRequestSchema,
  leaveWriteRequestSchema,
} from "./calls-calendar";
export type { LeaveDay, LeaveOutcome, LeaveWriteResponse } from "./calls-calendar";
