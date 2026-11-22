// The browser's entry of this unit: the pure names the client components use (R0). Nothing here
// may reach the database, the network or a secret: a client component bundles every file it names.
export { MAX_NAME_LENGTH } from "./name-policy";
export type { ApiScope } from "./oauth";
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, isPasswordLengthValid } from "./password-policy";
export { accessControl, roles } from "./permissions";
export { identityProviderUrl, OIDC_PROVIDER_ID } from "./provider";
export { API_SCOPES } from "./scopes";
export type { Scope } from "./scopes";
export type { TwoFactorPolicy } from "./two-factor-policy";
export { authorizeContinuation, safeNext } from "./oauth";
export { TRUST_DEVICE_DAYS, TWO_FACTOR_SETUP_PATH } from "./two-factor-policy";
