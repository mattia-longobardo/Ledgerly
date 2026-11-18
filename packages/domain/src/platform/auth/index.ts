// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { hasPasswordAccount, hasSsoAccount } from "./accounts";
export { TRUST_DEVICE_DAYS, getAuth } from "./auth";
export type { Auth } from "./auth";
export { invitationEmail } from "./emails";
export { redactForLog } from "./logger";
export { MAX_NAME_LENGTH, nameSchema } from "./name-policy";
export {
  GrantError,
  consentClient,
  listConnectedApps,
  revokeConnectedApp,
  revokeUserOAuthTokens,
} from "./oauth-grants";
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
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, isPasswordLengthValid } from "./password-policy";
export { accessControl, roles } from "./permissions";
export { OIDC_PROVIDER_ID, identityProviderUrl } from "./provider";
export { authAccounts, invitations, sessions, twoFactors, users, verifications } from "./schema";
export { MAX_CLIENT_NAME, parseScopes } from "./scopes";
export type { Scope } from "./scopes";
export { TWO_FACTOR_SETUP_PATH, twoFactorSetupRequired } from "./two-factor-policy";
export type { TwoFactorPolicy } from "./two-factor-policy";
