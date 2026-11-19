import "server-only";
import type { Context, MiddlewareHandler } from "hono";
import { type AccessIdentity, authenticateAccessToken } from "@/platform/auth/access-token";
import { bearerChallenge, looksLikeJwt } from "@/platform/auth/access-token-rules";
import { sessionCtxOf } from "@/platform/auth/session";
import { redactForLog } from "@ledgerly/domain/platform/auth";
import { resourceMetadataUrl } from "@ledgerly/domain/platform/auth";
import { type ContractScope, SESSION_HEADER } from "@ledgerly/api-contract";
import type { ApiEnv } from "@ledgerly/api";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { readEnv } from "@ledgerly/domain/platform/env";
import { fail } from "./errors";
import { MAX_PER_WINDOW, takeSlot } from "./rate-limit";
import { fromAppOrigin } from "./same-origin";

/**
 * Who called: an OAuth access token with `aud` = `/api/v1` (docs/auth-design.md T5), or the web's
 * own session cookie, from the same origin (03-releases.md §R4, git-policy §6 #4). `budget` is the
 * key of the rate limit: one per client, one per person for the web.
 */
interface ApiIdentity {
  ctx: Ctx;
  scopes: readonly ContractScope[];
  budget: string;
}

/**
 * What a person's web session may do: their own scopes, never a client's. `admin` only for an
 * admin, and `serve` checks the role again at every call. `imports` and `investments:read` come
 * with the screens that need them.
 */
const SESSION_SCOPES: readonly ContractScope[] = ["read", "write", "security"];

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
  return oauth && { ctx: oauth.ctx, scopes: oauth.scopes, budget: `client:${oauth.clientId}` };
}

async function identifySession(headers: Headers): Promise<ApiIdentity | null> {
  const ctx = await sessionCtxOf(headers);
  if (!ctx) return null;
  const scopes: readonly ContractScope[] =
    ctx.role === "admin" ? [...SESSION_SCOPES, "admin"] : SESSION_SCOPES;
  return { ctx, scopes, budget: `user:${ctx.userId}` };
}

/** Who a request is from (a token, or the web's session), or the refusal it gets. */
async function callerOf(request: Context): Promise<ApiIdentity | Response> {
  const match = BEARER.exec(request.req.header("authorization") ?? "");
  // The cookie counts only with the header a cross-origin page cannot send (no CORS, ever).
  const bySession = !match && request.req.header(SESSION_HEADER) !== undefined;
  if (!match && !bySession) {
    challenge(request);
    return fail(request, "unauthorized");
  }
  if (
    bySession &&
    !fromAppOrigin(request.req.raw.headers, request.req.method, new URL(readEnv().BETTER_AUTH_URL).origin)
  ) {
    return fail(request, "forbidden");
  }
  let identity: ApiIdentity | null;
  try {
    identity = match ? await identify(match[1]) : await identifySession(request.req.raw.headers);
  } catch (error) {
    console.error("[api] token lookup failed", redactForLog(error));
    return fail(request, "server_error");
  }
  if (!identity) {
    challenge(request, match ? { error: "invalid_token" } : undefined);
    return fail(request, "unauthorized");
  }
  return identity;
}

/**
 * The one place `/api/v1` authenticates (plan F8 §3.4.9, docs/auth-design.md D3/D4).
 *
 * The credential — a token, or the web's session with {@link SESSION_HEADER} from the app's origin —
 * becomes the same `Ctx` the screen has, so every service underneath scopes its queries with
 * `userScoped(ctx)`. The scope checked here is a **second** gate, never the first; an `admin` route
 * checks the role again at every call (`apps/api` `serve`). A cookie from another origin, or a write
 * without its `Origin`, is `403`: there is no CORS for the cookie.
 *
 * A 401 carries `WWW-Authenticate` with the RFC 9728 metadata URL, so a client can discover where
 * to get a token; a 403 says `insufficient_scope` and names the scope the route needs.
 */
export function withToken(scope: ContractScope): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const identity = await callerOf(c);
    if (identity instanceof Response) return identity;

    // One budget per client (D6: key = client_id), one per person for the web.
    const verdict = await takeSlot(identity.budget);
    c.header("X-RateLimit-Limit", String(MAX_PER_WINDOW));
    c.header("X-RateLimit-Remaining", String(verdict.remaining));
    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfter));
      return fail(c, "rate_limited");
    }
    // A token carries the scopes its client was granted: a Client API never gets `security` or `admin`.
    if (!identity.scopes.includes(scope)) {
      challenge(c, { error: "insufficient_scope", scope });
      return fail(c, "forbidden");
    }

    c.set("ctx", identity.ctx);
    await next();
  };
}
