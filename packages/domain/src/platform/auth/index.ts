// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { hasPasswordAccount, hasSsoAccount, isActiveUser } from "./accounts";
export { TRUST_DEVICE_DAYS, getAuth } from "./auth";
export type { Auth } from "./auth";
export { redactForLog } from "./logger";
export { nameSchema } from "./name-policy";
export { GrantError, consentClient, listConnectedApps, revokeConnectedApp } from "./oauth-grants";
export {
  ACCESS_TOKEN_TYPE,
  API_SCOPES,
  AUTH_BASE_PATH,
  RESOURCE_PATHS,
  authorizeContinuation,
  issuerFor,
  protectedResourceMetadata,
  resourceFor,
  resourceMetadataUrl,
  safeNext,
} from "./oauth";
export type { ApiScope, ResourceKey } from "./oauth";
export { oauthClients } from "./oauth/schema";
export { ProfileError, profileOf, renameProfile } from "./profile";
export { identityProviderUrl } from "./provider";
export { users } from "./schema";
export { MAX_CLIENT_NAME, parseScopes } from "./scopes";
export { TWO_FACTOR_SETUP_PATH, twoFactorSetupRequired } from "./two-factor-policy";
export {
  acceptInvitation,
  completeInvitationWithSso,
  deleteExpiredInvitations,
  findInvitation,
  hashToken,
  InvitationError,
} from "./invitations";
export {
  AdminError,
  invitePerson,
  listPeople,
  removePerson,
  resetPersonTwoFactor,
  revokeInvitation,
  sendPersonReset,
  setPersonBlocked,
  setPersonRole,
} from "./people";
export type { AdminErrorCode, InviteOutcome, PersonStatus, ResetOutcome, SignInMethod } from "./people";
export { ApiClientError, createApiClientWith, deleteApiClient, listApiClients } from "./client-registry";
export type { MintedClient } from "./client-registry";
export { endOwnSession } from "./own-sessions";
