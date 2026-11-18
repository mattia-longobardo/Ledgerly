// Users and settings · security and people (rewrite plan R2): behind the scopes `security` and
// `admin`, which only the first-party clients will be granted (git-policy §6 #4): until then every
// token is answered 403. The making of a Client API needs the person's session (Better Auth) and
// comes with that change.
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import {
  AdminError,
  ApiClientError,
  deleteApiClient,
  endOwnSession,
  GrantError,
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

function serveSecurity(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, security.listSessions, async ({ ctx }) => ({
    sessions: (await listOwnSessions(ctx)).map((session) => ({
      id: session.id,
      ...describeUserAgent(session.userAgent),
      ipAddress: session.ipAddress,
      createdAt: session.createdAt.toISOString(),
    })),
  }));
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

/** The routes of security and people; `POST /api-clients` comes with §6 #4. */
export function serveSecurityAndPeople(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveSecurity(app, guard);
  servePeople(app, guard);
  return [...Object.values(security), ...Object.values(people)].filter(
    (route) => route !== security.createApiClient,
  );
}
