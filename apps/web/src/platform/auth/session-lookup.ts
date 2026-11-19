// The session a request carries, read from its headers: what the pages (`session.ts`) and the guard
// of `/api/v1` share. Nothing of Next here, so the API runs it outside a render too. The one file of
// the session that reads the users module.
import "server-only";
import { buildCtx, getPreferences, type Preferences } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { readEnv } from "@ledgerly/domain/platform/env";
import { getAuth, hasPasswordAccount, twoFactorSetupRequired } from "@ledgerly/domain/platform/auth";

/** The person whose session cookie `requestHeaders` carry, as the pages read it (`session.ts`). */
export async function signedInWith(requestHeaders: Headers) {
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const policy = readEnv().TWO_FACTOR_POLICY;
  const twoFactorEnabled = session.user.twoFactorEnabled === true;
  // The account lookup only when it can change the answer: most requests skip it.
  const setupPending =
    policy === "required" &&
    !twoFactorEnabled &&
    twoFactorSetupRequired({
      policy,
      twoFactorEnabled,
      hasPassword: await hasPasswordAccount(session.user.id),
    });
  return {
    user: session.user,
    preferences: await getPreferences({ userId: session.user.id }),
    setupPending,
  };
}

/** The session's context: the one mapping of the domain (audit USR-3). */
export { buildCtx as ctxFrom };
export type { Preferences };

/** A session still waiting for its TOTP setup has no context: it is treated as signed out. */
export function ctxOf(signedIn: Awaited<ReturnType<typeof signedInWith>>): Ctx | null {
  return signedIn && !signedIn.setupPending ? buildCtx(signedIn.user, signedIn.preferences) : null;
}

/**
 * The context of the session a request's cookie carries, or null — the same rule as
 * the pages (`getOptionalCtx`), for a caller that holds the request (the guard of `/api/v1`).
 */
export async function sessionCtxOf(requestHeaders: Headers): Promise<Ctx | null> {
  return ctxOf(await signedInWith(requestHeaders));
}
