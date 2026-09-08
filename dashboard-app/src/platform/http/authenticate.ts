import type { DbClient } from "@/lib/db/client";
import { authenticateToken, parseToken } from "@/platform/auth/pat";
import { resolvePrincipal } from "@/platform/auth/principal";
import type { Authenticated } from "./app";

export interface AuthenticateOptions {
  db: DbClient;
  /**
   * The signed-in session's external subject, or `null`. Injected rather than
   * imported so this branch order is testable: `getUserOrNull` reaches for
   * Auth.js and `next/headers`, neither of which exists in a test request.
   */
  sessionSubject(): Promise<string | null>;
  /** Identity provider the subject belongs to — `PROVIDER_ID` in production. */
  provider: string;
  now(): Date;
}

/**
 * The API's one authentication function, in the order the two credentials are
 * checked.
 *
 * A Bearer header wins outright: if it is present and the token does not
 * authenticate, the request is refused rather than quietly falling back to
 * whatever cookie the browser happened to send. Falling back would mean a
 * revoked or expired token silently kept working for anyone who was also
 * signed in — the one case where a revocation must be visible.
 *
 * The `method` this returns is what the CSRF middleware in `app.ts` keys on:
 * `"token"` is exempt from `X-Requested-With` because a browser never attaches
 * an Authorization header on its own, so a cross-site form cannot forge one.
 */
export function createAuthenticate(opts: AuthenticateOptions): (req: Request) => Promise<Authenticated | null> {
  return async (req: Request) => {
    const token = parseToken(req.headers.get("authorization"));
    if (token !== null) {
      const authenticated = await authenticateToken(opts.db, token, opts.now());
      return authenticated ? { principal: authenticated.principal, method: "token" as const } : null;
    }

    const subject = await opts.sessionSubject();
    if (subject === null) return null;
    const principal = await resolvePrincipal(opts.db, { provider: opts.provider, subject });
    return principal ? { principal, method: "session" as const } : null;
  };
}
