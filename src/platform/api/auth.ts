import "server-only";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessIdentity, authenticateAccessToken } from "@/platform/auth/access-token";
import { bearerChallenge, looksLikeJwt } from "@/platform/auth/access-token-rules";
import { redactForLog } from "@/platform/auth/logger";
import { resourceMetadataUrl } from "@/platform/auth/oauth";
import type { Scope } from "@/platform/auth/scopes";
import type { Ctx } from "@/platform/context";
import { readEnv } from "@/platform/env";
import { fail } from "./errors";
import { MAX_PER_WINDOW, takeSlot } from "./rate-limit";

/**
 * Who called: an OAuth access token with `aud` = `/api/v1`, the only credential accepted since the
 * personal access tokens were removed (docs/auth-design.md T5).
 */
export interface ApiIdentity {
  kind: "oauth";
  ctx: Ctx;
  scopes: Scope[];
  clientId: string;
}

/** What every `/api/v1` handler can read off the context once the token has been accepted. */
export interface ApiEnv {
  Variables: { identity: ApiIdentity; ctx: Ctx };
}

const BEARER = /^Bearer\s+(\S+)$/i;

function challenge(c: Context, failure?: Parameters<typeof bearerChallenge>[1]): void {
  c.header(
    "WWW-Authenticate",
    bearerChallenge(resourceMetadataUrl(readEnv().BETTER_AUTH_URL, "api"), failure),
  );
}

async function identify(value: string): Promise<ApiIdentity | null> {
  // A former personal access token (`pat_…`) is not a JWT: it ends here, as an invalid token.
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

    // One budget per client (D6: key = client_id).
    const verdict = takeSlot(`client:${identity.clientId}`);
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
    await next();
  };
}
