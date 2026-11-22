import "server-only";
import { createLocalJWKSet, type JSONWebKeySet, type JWTVerifyGetKey } from "jose";
import { eq } from "drizzle-orm";
import { getSavedPreferences } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { getDb } from "@ledgerly/domain/platform/db";
import { readEnv } from "@ledgerly/domain/platform/env";
import { principalOf, verifyAccessJwt } from "./access-token-rules";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { type ApiScope, issuerFor, type ResourceKey, resourceFor } from "@ledgerly/domain/platform/auth";
import { oauthClients } from "@ledgerly/domain/platform/auth";
import { users } from "@ledgerly/domain/platform/auth";
import { buildCtx } from "@ledgerly/domain/users";

/**
 * The resource server of D3: turns an OAuth access token into the same `Ctx` a session would be.
 * `/api/v1` and `/api/mcp` both use it — the only difference is the audience.
 *
 * Validation is local: the JWKS comes from this process's own Better Auth, so the API does not
 * depend on Authentik or on a network call per request. The client row is read on every call, on
 * purpose: deleting a Client API in Settings must stop its tokens now, not in an hour.
 */

export interface AccessIdentity {
  ctx: Ctx;
  scopes: ApiScope[];
  clientId: string;
}

/** How long the key set is trusted before it is read again; a key it lacks forces a re-read. */
const JWKS_TTL_MS = 5 * 60_000;

let cachedKeys: { keys: JWTVerifyGetKey; kids: Set<string>; at: number } | null = null;

async function loadKeys(): Promise<NonNullable<typeof cachedKeys>> {
  const set = (await (await getAuth()).api.getJwks()) as JSONWebKeySet;
  cachedKeys = {
    keys: createLocalJWKSet(set),
    kids: new Set(set.keys.map((key) => key.kid).filter((kid): kid is string => typeof kid === "string")),
    at: Date.now(),
  };
  return cachedKeys;
}

/** The key set, re-read when it is old or when a token names a key it does not hold (rotation). */
async function keysFor(token: string): Promise<JWTVerifyGetKey> {
  let kid: string | undefined;
  try {
    const header = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8")) as {
      kid?: unknown;
    };
    kid = typeof header.kid === "string" ? header.kid : undefined;
  } catch {
    kid = undefined;
  }
  const current = cachedKeys;
  if (current && Date.now() - current.at < JWKS_TTL_MS && (kid === undefined || current.kids.has(kid))) {
    return current.keys;
  }
  return (await loadKeys()).keys;
}

/**
 * Who an access token is for one resource, or null. Null covers every reason at once — bad
 * signature, wrong audience, expired, unknown or disabled client, blocked person.
 */
export async function authenticateAccessToken(
  token: string,
  resource: ResourceKey,
): Promise<AccessIdentity | null> {
  const baseUrl = readEnv().BETTER_AUTH_URL;
  const claims = await verifyAccessJwt(token, await keysFor(token), {
    issuer: issuerFor(baseUrl),
    audience: resourceFor(baseUrl, resource),
  });
  if (!claims) return null;
  const [client] = await getDb()
    .select({ clientId: oauthClients.clientId, userId: oauthClients.userId, disabled: oauthClients.disabled })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, claims.clientId));
  const principal = principalOf(claims, client ?? null);
  if (!principal) return null;
  const [person] = await getDb()
    .select({ role: users.role, banned: users.banned })
    .from(users)
    .where(eq(users.id, principal.userId));
  // A blocked person is blocked everywhere, not only at the sign-in form.
  if (!person || person.banned) return null;
  const preferences = await getSavedPreferences({ userId: principal.userId });
  return {
    ctx: buildCtx({ id: principal.userId, role: person.role }, preferences),
    scopes: principal.scopes,
    clientId: principal.clientId,
  };
}
