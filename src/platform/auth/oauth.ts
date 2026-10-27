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

/**
 * What a self-registered (DCR) client may hold: the read-only MCP and a refresh token, nothing on
 * `/api/v1` (PERS-49 SEC-01). Write access stays with the Client API a person makes in Settings.
 */
export const DCR_SCOPES = ["read", "offline_access"] as const;

/** The domain scopes each resource advertises (RFC 9728): the MCP is read-only. */
const RESOURCE_SCOPES: Record<ResourceKey, readonly ApiScope[]> = { api: API_SCOPES, mcp: ["read"] };

/** The protected-resource metadata document of RFC 9728 for one resource. */
export function protectedResourceMetadata(baseUrl: string, key: ResourceKey) {
  return {
    resource: resourceFor(baseUrl, key),
    authorization_servers: [issuerFor(baseUrl)],
    scopes_supported: [...RESOURCE_SCOPES[key]],
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

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The https redirect URIs a self-registering client may use, besides plain http on a loopback host
 * (Claude Code, MCP Inspector). Anything else is refused at registration (PERS-49 SEC-01): an
 * attacker's client could otherwise send the authorization code to a host of its own choosing.
 */
export const DCR_REDIRECT_ALLOWLIST: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

function isLoopbackHttp(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Whether every redirect URI of a registration is a loopback one or on the allowlist. */
export function registrationRedirectsAllowed(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const uris = (body as Record<string, unknown>).redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0) return false;
  return uris.every(
    (uri) => typeof uri === "string" && (isLoopbackHttp(uri) || DCR_REDIRECT_ALLOWLIST.includes(uri)),
  );
}

/**
 * The `scope` a registration is stored with: what it asked for, narrowed to {@link DCR_SCOPES}.
 * MCP clients send one scope union to every server; narrowing it keeps them working where a refusal
 * would break the connection, and the plugin then never lets the client ask for more.
 */
export function registrationScope(body: unknown): string {
  const asked = body && typeof body === "object" ? (body as Record<string, unknown>).scope : undefined;
  const requested = typeof asked === "string" ? asked.split(" ").filter(Boolean) : [];
  const kept = DCR_SCOPES.filter((scope) => requested.includes(scope));
  return (kept.length > 0 ? kept : ["read"]).join(" ");
}

/** The hosts a client's redirect URIs point at, for the consent screen; unparsable ones as given. */
export function redirectHosts(uris: readonly string[]): string[] {
  const hosts = uris.map((uri) => {
    try {
      return new URL(uri).host;
    } catch {
      return uri;
    }
  });
  return [...new Set(hosts)];
}

/**
 * The `application_type` a self-registering client gets when it names none (D3: redirect URIs
 * https or loopback). OpenID DCR defaults to `web`, and the plugin refuses a loopback redirect for
 * a `web` client — yet `http://localhost:<port>/callback` is exactly what desktop MCP clients
 * (Claude Code, MCP Inspector) register, RFC 8252 §7.3. So a client whose every redirect is plain
 * http on a loopback host is a `native` one; anything else is left as it came.
 */
export function registrationApplicationType(body: unknown): "native" | undefined {
  if (!body || typeof body !== "object") return undefined;
  const { application_type: type, redirect_uris: uris } = body as Record<string, unknown>;
  if (type !== undefined || !Array.isArray(uris) || uris.length === 0) return undefined;
  return uris.every((uri) => typeof uri === "string" && isLoopbackHttp(uri)) ? "native" : undefined;
}
