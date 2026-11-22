import "server-only";
import { buildCtx, getPreferences, type Preferences } from "@ledgerly/domain/users";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { readEnv } from "@ledgerly/domain/platform/env";
import { getAuth, hasPasswordAccount, twoFactorSetupRequired } from "@ledgerly/domain/platform/auth";

/** The users module, read here once for the pages too (`session.ts`). */
export { buildCtx, type Preferences };

// The session of a request's headers, with no import of Next.js: the pages read it through
// `session.ts` (cached per render), `/api/v1` through `sessionCtxOf`, also outside a Next runtime
// (`npm run perf` loads the API in Node).

/**
 * The signed-in user of a request's headers and their saved preferences, or null. `setupPending`:
 * the session is real but the person still has to set up TOTP (TWO_FACTOR_POLICY=required), so it
 * opens only the setup page and nothing else. A blocked person's sessions are deleted when they
 * are blocked; `banned` is checked too, so a session that outlived it opens nothing either.
 */
export async function signedInFrom(requestHeaders: Headers) {
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

/**
 * The context of the session cookie in `requestHeaders`, by the same rules as every page: no
 * session, a session still owing its TOTP setup, or a blocked person is null. For `/api/v1`, which
 * reads the headers of its own request (`platform/api/auth.ts`).
 */
export async function sessionCtxOf(requestHeaders: Headers): Promise<Ctx | null> {
  const signedIn = await signedInFrom(requestHeaders);
  if (!signedIn || signedIn.setupPending || signedIn.user.banned === true) return null;
  return buildCtx(signedIn.user, signedIn.preferences);
}

/** What `/api/web/session` answers: the person, their preferences, their context, the setup gate. */
export function remoteSignedIn(signedIn: Awaited<ReturnType<typeof signedInFrom>>) {
  return (
    signedIn && {
      user: { id: signedIn.user.id, role: signedIn.user.role ?? null, email: signedIn.user.email },
      preferences: signedIn.preferences,
      ctx: buildCtx(signedIn.user, signedIn.preferences),
      setupPending: signedIn.setupPending,
    }
  );
}

/**
 * The context of the request's session with the session's id, or null. For the one flow that leaves
 * the app and comes back (an access to a bank, `/api/v1/plugins/<id>/callback`): what comes back must
 * have left from this very session, so the id is what the flow is tied to. The id never goes to a
 * browser, nor to the web's container.
 */
export async function getOptionalSession(
  requestHeaders: Headers,
): Promise<{ ctx: Ctx; sessionId: string } | null> {
  const ctx = await sessionCtxOf(requestHeaders);
  if (!ctx) return null;
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  return session ? { ctx, sessionId: session.session.id } : null;
}
