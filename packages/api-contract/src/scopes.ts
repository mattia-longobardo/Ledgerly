// The scopes a route of `/api/v1` can ask for (10-modularity.md §10.2: «scope per risorsa»). The
// first four are the ones the authorization server grants today (`@ledgerly/domain/platform/auth`,
// held equal by `apps/api`); `security` and `admin` are declared by the contract of users and
// settings and become grantable only with the change of the authorization server (git-policy §6 #4).
// `session` is the web's own session only, never a token's (H45): what only the pages of Ledgerly may
// read, the IBAN of an account. The authorization server never grants it, so a token gets 403.
export const CONTRACT_SCOPES = [
  "read",
  "write",
  "imports",
  "investments:read",
  "security",
  "admin",
  "session",
] as const;

export type ContractScope = (typeof CONTRACT_SCOPES)[number];
