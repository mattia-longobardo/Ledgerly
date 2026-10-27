/**
 * Ledgerly as an OAuth 2.0 Authorization Server (docs/auth-design.md D3): the issuer, the protected
 * resources and the scopes, as plain values. Nothing here touches the database or Better Auth, so
 * the resource server (`platform/api/auth.ts`, and the MCP route after it) and the unit tests can
 * import it freely.
 */
import { TOKEN_SCOPES } from "@/platform/tokens/rules";

/** Better Auth's own mount point: the issuer is `<origin>/api/auth`. */
export const AUTH_BASE_PATH = "/api/auth";

/** The domain scopes, the same three names the personal access tokens had. */
export const API_SCOPES = TOKEN_SCOPES;
export type ApiScope = (typeof API_SCOPES)[number];

/** Every scope the server knows: the domain ones plus the OpenID Connect ones. */
export const OAUTH_SCOPES = [...API_SCOPES, "openid", "profile", "email", "offline_access"] as const;

/** RFC 8707 resources: a token carries one of these as `aud`, and is good for that one only. */
export const RESOURCE_PATHS = { api: "/api/v1", mcp: "/api/mcp" } as const;
export type ResourceKey = keyof typeof RESOURCE_PATHS;

/** Access tokens live an hour, refresh tokens 30 days (D3). */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** The `typ` header of an access token (RFC 9068). An ID token or a session JWT has another one. */
export const ACCESS_TOKEN_TYPE = "at+jwt";

/** Where the authorize endpoint sends a person who has to say yes. */
export const AUTHORIZE_PATH = `${AUTH_BASE_PATH}/oauth2/authorize`;
export const CONSENT_PAGE = "/oauth/consent";
export const LOGIN_PAGE = "/sign-in";

export function originOf(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

export function issuerFor(baseUrl: string): string {
  return `${originOf(baseUrl)}${AUTH_BASE_PATH}`;
}

export function resourceFor(baseUrl: string, key: ResourceKey): string {
  return `${originOf(baseUrl)}${RESOURCE_PATHS[key]}`;
}

/** RFC 9728: `/.well-known/oauth-protected-resource` followed by the resource's own path. */
export function resourceMetadataUrl(baseUrl: string, key: ResourceKey): string {
  return `${originOf(baseUrl)}/.well-known/oauth-protected-resource${RESOURCE_PATHS[key]}`;
}

/** The protected-resource metadata document of RFC 9728 for one resource. */
export function protectedResourceMetadata(baseUrl: string, key: ResourceKey) {
  return {
    resource: resourceFor(baseUrl, key),
    authorization_servers: [issuerFor(baseUrl)],
    scopes_supported: [...API_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: key === "api" ? "Ledgerly API" : "Ledgerly MCP",
  };
}

/**
 * Where a sign-in started by the authorize endpoint goes once it has a session: back to the
 * authorize endpoint, with the request it was given. The signature the plugin added (`sig`,
 * `exp`, and its own `ba_*` markers) is dropped, and so is `prompt`, which would otherwise send the
 * person straight back to the sign-in page. Anything that is not an authorization request — no
 * `client_id`, no `response_type` — has no business here and yields null.
 */
export function authorizeContinuation(params: Record<string, string | string[] | undefined>): string | null {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (key === "sig" || key === "exp" || key === "prompt" || key.startsWith("ba_")) continue;
    for (const one of Array.isArray(value) ? value : [value]) query.append(key, one);
  }
  if (!query.get("client_id") || !query.get("response_type")) return null;
  return `${AUTHORIZE_PATH}?${query.toString()}`;
}

/**
 * The only destinations a sign-in may be sent to after it succeeds: the app itself, or the
 * authorize endpoint of this same server. Whatever came in a query string is checked against
 * this, so a crafted link cannot turn the sign-in page into an open redirect.
 */
export function safeNext(value: string | null | undefined): string {
  if (!value) return "/";
  if (value.startsWith(`${AUTHORIZE_PATH}?`) && !value.includes("\\") && !/[\r\n]/.test(value)) return value;
  return "/";
}
