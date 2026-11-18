// The scopes a route of `/api/v1` can ask for (10-modularity.md §10.2: «scope per risorsa»). The
// first four are the ones the authorization server grants today (`@ledgerly/domain/platform/auth`,
// held equal by `apps/api`); `security` and `admin` are declared by the contract of users and
// settings and become grantable only with the change of the authorization server (git-policy §6 #4).
export const CONTRACT_SCOPES = ["read", "write", "imports", "investments:read", "security", "admin"] as const;

export type ContractScope = (typeof CONTRACT_SCOPES)[number];
