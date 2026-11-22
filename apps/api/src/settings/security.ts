// Users and settings · security and people (rewrite plan R2): behind the scopes `security` and
// `admin`, which only the first-party clients will be granted (git-policy §6 #4): until then every
// token is answered 403. A Client API is made inside the person's session (Better Auth): the cookie
// of the call is the session, as it was for the Server Action.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import {
  AdminError,
  ApiClientError,
  createApiClientWith,
  deleteApiClient,
  endOwnSession,
  getAuth,
  GrantError,
  hasPasswordAccount,
  hasSsoAccount,
  identityProviderUrl,
  invitePerson,
  listApiClients,
  listConnectedApps,
  listPeople,
  removePerson,
  resetPersonTwoFactor,
  revokeConnectedApp,
  revokeInvitation,
  sendPersonReset,
  setPersonBlocked,
  setPersonRole,
} from "@ledgerly/domain/platform/auth";
import { readEnv } from "@ledgerly/domain/platform/env";
import { describeUserAgent, listOwnSessions } from "@ledgerly/domain/users";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { security, people } = SETTINGS;

/** A refusal of the domain as the contract names it. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof AdminError || error instanceof ApiClientError || error instanceof GrantError))
      throw error;
    if (error.code === "not_found") throw new ApiRefusal("not_found");
    if (error.code === "invalid") throw new ApiRefusal("invalid");
    if (error.code === "forbidden") throw new ApiRefusal("forbidden");
    throw new ApiRefusal("conflict", error.code);
  }
}

/** The session of the cookie that made the call; none when a Bearer token did (it decides alone). */
async function currentSessionId(headers: Headers): Promise<string | null> {
  if (headers.has("authorization")) return null;
  return (await (await getAuth()).api.getSession({ headers }))?.session.id ?? null;
}

function serveSecurity(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, security.listSessions, async ({ ctx, headers }) => {
    const [own, current] = await Promise.all([listOwnSessions(ctx), currentSessionId(headers)]);
    return {
      sessions: own.map((session) => ({
        id: session.id,
        ...describeUserAgent(session.userAgent),
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
        current: session.id === current,
      })),
    };
  });
  serve(app, guard, security.getSignIn, async ({ ctx }) => {
    const [password, sso] = await Promise.all([hasPasswordAccount(ctx.userId), hasSsoAccount(ctx.userId)]);
    return {
      password,
      sso,
      identityProvider: identityProviderUrl()?.origin ?? null,
      twoFactorPolicy: readEnv().TWO_FACTOR_POLICY,
    };
  });
  // A session that is not the person's answers as one already gone (the Server Action does the same).
  serve(app, guard, security.revokeSession, async ({ ctx, params }) => {
    await endOwnSession(ctx, params.id);
  });
  serve(app, guard, security.listApiClients, async ({ ctx }) => ({
    clients: (await listApiClients(ctx)).map((client) => ({
      ...client,
      createdAt: client.createdAt.toISOString(),
    })),
  }));
  // The secret is answered once; only its hash is kept. A refusal of the input is `invalid`, as the action's.
  serve(app, guard, security.createApiClient, async ({ body, headers }) =>
    refusing(async () => createApiClientWith(await getAuth(), headers, body)),
  );
  serve(app, guard, security.deleteApiClient, ({ ctx, params }) =>
    refusing(() => deleteApiClient(ctx, params.clientId)),
  );
  serve(app, guard, security.listConnectedApps, async ({ ctx }) => ({
    apps: (await listConnectedApps(ctx)).map((one) => ({ ...one, createdAt: one.createdAt.toISOString() })),
  }));
  serve(app, guard, security.revokeConnectedApp, ({ ctx, params }) =>
    refusing(() => revokeConnectedApp(ctx, params.clientId)),
  );
}

function servePeople(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, people.listPeople, async ({ ctx }) => ({
    people: (await refusing(() => listPeople(ctx))).map((one) => ({
      ...one,
      lastSignInAt: one.lastSignInAt?.toISOString() ?? null,
    })),
  }));
  serve(app, guard, people.invitePerson, async ({ ctx, body }) => ({
    outcome: await refusing(() => invitePerson(ctx, body)),
  }));
  serve(app, guard, people.revokeInvitation, ({ ctx, params }) =>
    refusing(() => revokeInvitation(ctx, params.id)),
  );
  serve(app, guard, people.updatePerson, ({ ctx, params, body }) =>
    refusing(async () => {
      if (body.role !== undefined) await setPersonRole(ctx, params.id, body.role);
      if (body.blocked !== undefined) await setPersonBlocked(ctx, params.id, body.blocked);
    }),
  );
  serve(app, guard, people.sendPersonReset, async ({ ctx, params }) => ({
    outcome: await refusing(() => sendPersonReset(ctx, params.id)),
  }));
  serve(app, guard, people.resetPersonTwoFactor, ({ ctx, params }) =>
    refusing(() => resetPersonTwoFactor(ctx, params.id)),
  );
  serve(app, guard, people.removePerson, ({ ctx, params }) => refusing(() => removePerson(ctx, params.id)));
}

/** The routes of security and people. */
export function serveSecurityAndPeople(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveSecurity(app, guard);
  servePeople(app, guard);
  return [...Object.values(security), ...Object.values(people)];
}
