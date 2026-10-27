import "server-only";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessIdentity, authenticateAccessToken } from "@/platform/auth/access-token";
import { bearerChallenge, looksLikeJwt } from "@/platform/auth/access-token-rules";
import { redactForLog } from "@/platform/auth/logger";
import { resourceMetadataUrl } from "@/platform/auth/oauth";
import type { Ctx } from "@/platform/context";
import { readEnv } from "@/platform/env";
import { type Scope } from "@/platform/tokens/rules";
import { authenticateToken, type TokenIdentity, touchToken } from "@/platform/tokens/service";
import { fail } from "./errors";
import { MAX_PER_WINDOW, takeSlot } from "./rate-limit";

/**
 * Who called, whichever credential they used: an OAuth access token (`kind: "oauth"`, the way in
 * from now on) or a personal access token kept for the transition (`kind: "pat"`, D4).
 */
export type ApiIdentity =
  | { kind: "oauth"; ctx: Ctx; scopes: Scope[]; clientId: string }
  | { kind: "pat"; ctx: Ctx; scopes: Scope[]; tokenId: string };

/** What every `/api/v1` handler can read off the context once the token has been accepted. */
export interface ApiEnv {
  Variables: { identity: ApiIdentity; ctx: Ctx };
}

const BEARER = /^Bearer\s+(\S+)$/i;
const PAT_PREFIX = "pat_";

function challenge(c: Context, failure?: Parameters<typeof bearerChallenge>[1]): void {
  c.header(
    "WWW-Authenticate",
    bearerChallenge(resourceMetadataUrl(readEnv().BETTER_AUTH_URL, "api"), failure),
  );
}

async function identify(value: string): Promise<ApiIdentity | null> {
  if (value.startsWith(PAT_PREFIX)) {
    const pat: TokenIdentity | null = await authenticateToken(value);
    if (!pat) return null;
    // D4: every use is logged, so the end of the transition (T5) is decided on evidence.
    console.info(`[api] legacy token used (${pat.tokenId})`);
    return { kind: "pat", ctx: pat.ctx, scopes: pat.scopes, tokenId: pat.tokenId };
  }
  if (!looksLikeJwt(value)) return null;
  const oauth: AccessIdentity | null = await authenticateAccessToken(value, "api");
  return oauth && { kind: "oauth", ctx: oauth.ctx, scopes: oauth.scopes, clientId: oauth.clientId };
}

/**
 * The one place `/api/v1` authenticates (plan F8 §3.4.9, docs/auth-design.md D3/D4).
 *
 * The credential becomes the same `Ctx` a session would, so every service underneath scopes its
 * queries with `userScoped(ctx)` exactly as it does for the screen. The scope checked here is a
 * **second** gate, never the first: no administrative surface exists under `/api/v1` at all, and a
 * token of an admin gains nothing by being one (plan F8 §3.4.8).
 *
 * A 401 carries `WWW-Authenticate` with the RFC 9728 metadata URL, so a client can discover where
 * to get a token; a 403 says `insufficient_scope` and names the scope the route needs.
 */
export function withToken(scope: Scope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const match = BEARER.exec(c.req.header("authorization") ?? "");
    if (!match) {
      challenge(c);
      return fail(c, "unauthorized");
    }
    let identity: ApiIdentity | null;
    try {
      identity = await identify(match[1]);
    } catch (error) {
      console.error("[api] token lookup failed", redactForLog(error));
      return fail(c, "server_error");
    }
    if (!identity) {
      challenge(c, { error: "invalid_token" });
      return fail(c, "unauthorized");
    }

    // One budget per credential: a token for a PAT, the client for OAuth (D6: key = client_id).
    const verdict = takeSlot(identity.kind === "pat" ? identity.tokenId : `client:${identity.clientId}`);
    c.header("X-RateLimit-Limit", String(MAX_PER_WINDOW));
    c.header("X-RateLimit-Remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfter));
      return fail(c, "rate_limited");
    }
    if (!identity.scopes.includes(scope)) {
      challenge(c, { error: "insufficient_scope", scope });
      return fail(c, "forbidden");
    }

    c.set("identity", identity);
    c.set("ctx", identity.ctx);
    if (identity.kind === "pat") {
      // At most one write a minute, and a store that refuses must not fail the call it is only
      // recording (spec §5.3).
      try {
        await touchToken(identity.tokenId);
      } catch (error) {
        console.error("[api] could not record the token's use", redactForLog(error));
      }
    }
    await next();
  };
}
