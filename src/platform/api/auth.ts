import "server-only";
import type { MiddlewareHandler } from "hono";
import { redactForLog } from "@/platform/auth/logger";
import type { Ctx } from "@/platform/context";
import { type Scope } from "@/platform/tokens/rules";
import { authenticateToken, type TokenIdentity, touchToken } from "@/platform/tokens/service";
import { fail } from "./errors";
import { MAX_PER_WINDOW, takeSlot } from "./rate-limit";

/** What every `/api/v1` handler can read off the context once the token has been accepted. */
export interface ApiEnv {
  Variables: { identity: TokenIdentity; ctx: Ctx };
}

const BEARER = /^Bearer\s+(\S+)$/i;

/**
 * The one place `/api/v1` authenticates (plan F8 §3.4.9).
 *
 * The token becomes the same `Ctx` a session would, so every service underneath scopes its queries
 * with `userScoped(ctx)` exactly as it does for the screen. The scope checked here is a **second**
 * gate, never the first: no administrative surface exists under `/api/v1` at all, and a token of an
 * admin gains nothing by being one (plan F8 §3.4.8).
 */
export function withToken(scope: Scope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const match = BEARER.exec(c.req.header("authorization") ?? "");
    if (!match) return fail(c, "unauthorized");
    let identity: TokenIdentity | null;
    try {
      identity = await authenticateToken(match[1]);
    } catch (error) {
      console.error("[api] token lookup failed", redactForLog(error));
      return fail(c, "server_error");
    }
    if (!identity) return fail(c, "unauthorized");

    const verdict = takeSlot(identity.tokenId);
    c.header("X-RateLimit-Limit", String(MAX_PER_WINDOW));
    c.header("X-RateLimit-Remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfter));
      return fail(c, "rate_limited");
    }
    if (!identity.scopes.includes(scope)) return fail(c, "forbidden");

    c.set("identity", identity);
    c.set("ctx", identity.ctx);
    // At most one write a minute, and a store that refuses must not fail the call it is only
    // recording (spec §5.3).
    try {
      await touchToken(identity.tokenId);
    } catch (error) {
      console.error("[api] could not record the token's use", redactForLog(error));
    }
    await next();
  };
}
