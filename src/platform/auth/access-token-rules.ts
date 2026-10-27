/**
 * The resource-server half of D3 (docs/auth-design.md), as pure rules: what makes an access token
 * one of ours for a given resource, and whom it speaks for. No database and no Better Auth, so the
 * whole check is unit-testable with a key made on the spot; `access-token.ts` feeds it the keys
 * and the client row.
 */
import { errors, type JWTPayload, type JWTVerifyGetKey, jwtVerify } from "jose";
import { ACCESS_TOKEN_TYPE, API_SCOPES, type ApiScope } from "./oauth";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Seconds of clock drift tolerated on `exp`/`nbf`/`iat`: the issuer is this very process. */
const CLOCK_TOLERANCE_SECONDS = 5;

export interface AccessTokenClaims {
  sub: string;
  clientId: string;
  scopes: string[];
}

/**
 * Signature (against the JWKS), `typ` = `at+jwt`, issuer, audience and expiry. Null for any
 * failure — expired, foreign, forged, an ID token, a session JWT — because the caller answers all
 * of them with the same 401, and telling them apart would tell an attacker which guess was close.
 * A key-set that cannot be read is not the token's fault and is thrown, so it becomes a 500.
 */
export async function verifyAccessJwt(
  token: string,
  keys: JWTVerifyGetKey,
  expected: { issuer: string; audience: string },
): Promise<AccessTokenClaims | null> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, keys, {
      issuer: expected.issuer,
      audience: expected.audience,
      typ: ACCESS_TOKEN_TYPE,
      requiredClaims: ["exp", "sub"],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
  const clientId = payload.client_id ?? payload.azp;
  if (typeof payload.sub !== "string" || typeof clientId !== "string" || clientId === "") return null;
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  return { sub: payload.sub, clientId, scopes: scope.split(" ").filter(Boolean) };
}

export interface ClientRow {
  clientId: string;
  userId: string | null;
  disabled: boolean | null;
}

/**
 * Whom a verified token acts for. A token from the authorization-code flow names its person in
 * `sub`; a `client_credentials` token names its client there (`sub` = `client_id`), and the
 * client's owner is the person — which is what makes a "Client API" behave like the personal
 * token it replaces. A client that is gone or disabled takes its tokens with it at once, without
 * waiting for them to expire: that is what "delete" has to mean on the Settings screen.
 */
export function principalOf(
  claims: AccessTokenClaims,
  client: ClientRow | null,
): { userId: string; clientId: string; scopes: ApiScope[] } | null {
  if (!client || client.clientId !== claims.clientId || client.disabled) return null;
  const machine = claims.sub === claims.clientId;
  const userId = machine ? client.userId : claims.sub;
  if (!userId || !UUID.test(userId)) return null;
  // A user-delegated token from an owned client must still be that owner's (a Client API never
  // acts for somebody else); a public client has no owner and acts for whoever consented.
  if (!machine && client.userId !== null && client.userId !== userId) return null;
  const scopes = API_SCOPES.filter((scope) => claims.scopes.includes(scope));
  return { userId, clientId: claims.clientId, scopes };
}

/** A bearer value in the shape of a JWT (three base64url parts), as opposed to a `pat_…` token. */
export function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/** RFC 6750 §3 + RFC 9728 §5.1: the challenge of a 401 or a 403. */
export function bearerChallenge(
  metadataUrl: string,
  failure: { error?: "invalid_token" | "insufficient_scope"; scope?: string } = {},
): string {
  const parts = [`resource_metadata="${metadataUrl}"`];
  if (failure.error) parts.unshift(`error="${failure.error}"`);
  if (failure.scope) parts.push(`scope="${failure.scope}"`);
  return `Bearer ${parts.join(", ")}`;
}
