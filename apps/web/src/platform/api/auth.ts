import "server-only";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessIdentity, authenticateAccessToken } from "@/platform/auth/access-token";
import { sessionCtxOf } from "@/platform/auth/signed-in";
import { bearerChallenge, looksLikeJwt } from "@/platform/auth/access-token-rules";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { resourceMetadataUrl } from "@ledgerly/domain/platform/auth";
import { type ContractScope, SESSION_CSRF_HEADER } from "@ledgerly/api-contract";
import type { ApiEnv } from "@ledgerly/api";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { readEnv } from "@ledgerly/domain/platform/env";
import { fail } from "./errors";
import { MAX_PER_WINDOW, SESSION_MAX_PER_WINDOW, takeSlot } from "./rate-limit";

/**
 * Who called: an OAuth access token with `aud` = `/api/v1` (docs/auth-design.md T5), or the web's
 * own session cookie, same origin (rewrite plan R4). `budget` is the key of the rate limit.
 */
interface ApiIdentity {
  kind: "oauth" | "session";
  ctx: Ctx;
  scopes: readonly string[];
  budget: string;
  /** The requests a minute `budget` allows: a token's, or the web session's own (H57). */
  limit: number;
}

/**
 * What the web's session may do: everything the person may, `admin` only for an admin, and `session`,
 * what only the pages of Ledgerly read (the IBAN, H45) and no token is ever granted. `imports`: the
 * Payroll screen uploads its payslips through `POST /imports` (R2 imports), as it did by its action.
 * `investments:read`: the Investments screens read `/api/v1` (R2 investments), as they read the domain.
 */
const SESSION_SCOPES: readonly ContractScope[] = [
  "read",
  "write",
  "imports",
  "investments:read",
  "security",
  "session",
];

/** The methods that change nothing: the only ones a session may call without the CSRF proof. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** What every `/api/v1` handler can read off the context once the token has been accepted. */
export type { ApiEnv };

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
  return (
    oauth && {
      kind: "oauth",
      ctx: oauth.ctx,
      scopes: oauth.scopes,
      budget: `client:${oauth.clientId}`,
      limit: MAX_PER_WINDOW,
    }
  );
}

/** The web's session in the request's cookie, or null (no session, TOTP setup owed, blocked). */
async function identifySession(headers: Headers): Promise<ApiIdentity | null> {
  const ctx = await sessionCtxOf(headers);
  if (!ctx) return null;
  const scopes = ctx.role === "admin" ? [...SESSION_SCOPES, "admin"] : SESSION_SCOPES;
  return { kind: "session", ctx, scopes, budget: `user:${ctx.userId}`, limit: SESSION_MAX_PER_WINDOW };
}

/**
 * A write with the session cookie came from a page of this instance: `Origin` is the instance's own
 * and the custom header is there. A form or a script of another site can send the cookie but not
 * the header without a CORS preflight, which `/api/v1` never answers; `Origin` closes the rest.
 */
function sameOriginWrite(context: Context): boolean {
  if (SAFE_METHODS.has(context.req.method)) return true;
  const origin = context.req.header("origin");
  return (
    origin !== undefined &&
    origin === new URL(readEnv().BETTER_AUTH_URL).origin &&
    (context.req.header(SESSION_CSRF_HEADER) ?? "") !== ""
  );
}

/**
 * The one place `/api/v1` authenticates (plan F8 §3.4.9, docs/auth-design.md D3/D4).
 *
 * Two credentials: a Bearer access token, or the web's session cookie (same origin, R4). A session
 * is read by the same rules as every page (`sessionCtxOf`) and gets `read`, `write`, `imports`,
 * `investments:read`, `security`, and `admin` for an admin; its writes need the CSRF proof (`sameOriginWrite`). No CORS answer is ever
 * given, so no other origin can send the cookie with a readable answer.
 *
 * The credential becomes the same `Ctx` a session would, so every service underneath scopes its
 * queries with `userScoped(ctx)` exactly as it does for the screen. The scope checked here is a
 * **second** gate, never the first: no administrative surface exists under `/api/v1` at all, and a
 * token of an admin gains nothing by being one (plan F8 §3.4.8).
 *
 * A 401 carries `WWW-Authenticate` with the RFC 9728 metadata URL, so a client can discover where
 * to get a token; a 403 says `insufficient_scope` and names the scope the route needs.
 */
export function withToken(scope: ContractScope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    // Precedence: an `Authorization` header decides alone, and the cookie is not read. A wrong or
    // malformed Bearer is a 401 even when a session cookie comes with it.
    const authorization = c.req.header("authorization");
    const match = authorization === undefined ? null : BEARER.exec(authorization);
    if (authorization !== undefined && !match) {
      challenge(c);
      return fail(c, "unauthorized");
    }
    let identity: ApiIdentity | null;
    try {
      identity = match ? await identify(match[1]) : await identifySession(c.req.raw.headers);
    } catch (error) {
      console.error("[api] token lookup failed", redactForLog(error));
      return fail(c, "server_error");
    }
    if (!identity) {
      challenge(c, match ? { error: "invalid_token" } : undefined);
      return fail(c, "unauthorized");
    }
    if (identity.kind === "session" && !sameOriginWrite(c)) return fail(c, "forbidden");

    // One budget per client (D6: key = client_id), one per person for the web's session.
    const verdict = await takeSlot(identity.budget, new Date(), identity.limit);
    c.header("X-RateLimit-Limit", String(identity.limit));
    c.header("X-RateLimit-Remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfter));
      return fail(c, "rate_limited");
    }
    // `security` and `admin` are granted to no token yet (git-policy §6 #4); the session has them.
    if (!identity.scopes.some((granted) => granted === scope)) {
      challenge(c, { error: "insufficient_scope", scope });
      return fail(c, "forbidden");
    }

    c.set("ctx", identity.ctx);
    await next();
  };
}
