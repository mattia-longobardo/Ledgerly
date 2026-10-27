/**
 * The domain scopes of `/api/v1` and `/api/mcp` (docs/auth-design.md D3), as pure rules. Nothing
 * here touches the database, so the client forms, the resource server and the unit tests share
 * one list.
 */

export const API_SCOPES = ["read", "write", "imports"] as const;
export type Scope = (typeof API_SCOPES)[number];

/** The scopes a person ticked, validated: a non-empty subset of {@link API_SCOPES}. */
export function parseScopes(input: readonly string[]): Scope[] | null {
  const scopes = API_SCOPES.filter((scope) => input.includes(scope));
  return scopes.length > 0 && scopes.length === new Set(input).size ? scopes : null;
}

/** The longest name a Client API can carry. */
export const MAX_CLIENT_NAME = 60;
