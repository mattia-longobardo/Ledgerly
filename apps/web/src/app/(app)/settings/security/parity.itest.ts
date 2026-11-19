// R3 parity of Settings › Security (03-releases.md §R3, criterion 11): what the server page read before
// it became a client screen — the sessions, the Client APIs and the connected apps — is what
// `GET /api/v1/sessions`, `/api-clients` and `/connected-apps` answer for the same person.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_CSRF_HEADER } from "@ledgerly/api-contract";
import { authAccounts } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api } = await import("@/app/api/v1/[[...route]]/composition");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { listApiClients, listConnectedApps } = await import("@ledgerly/domain/platform/auth");
const { describeUserAgent, listOwnSessions } = await import("@ledgerly/domain/users");
const { readEnv } = await import("@domain/platform/env");
const { createApiClientWith } = await import("@/platform/auth/api-clients");

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
});

afterAll(closeDatabase);

const origin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

/** A signed-in person with no password row: the session owes no TOTP setup. */
async function person() {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({
    body: { email, password: "correct-horse-battery", name: "Parity Person", role: "user" },
  });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: "correct-horse-battery" },
    returnHeaders: true,
    headers: new Headers({
      "user-agent": "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
    }),
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  const cookie = headers
    .getSetCookie()
    .map((one) => one.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  return { userId: created.user.id, cookie };
}

async function send(path: string, cookie: string, init: { method?: string; body?: unknown } = {}) {
  const write = (init.method ?? "GET") !== "GET";
  const headers: Record<string, string> = { cookie };
  if (write) Object.assign(headers, { origin: origin(), [SESSION_CSRF_HEADER]: "1" });
  if (init.body !== undefined) headers["content-type"] = "application/json";
  const response = await api.fetch(
    new Request(`${origin()}/api/v1${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );
  expect(response.status).toBeLessThan(300);
  return response.status === 204 ? null : response.json();
}

describe("Settings › Security, old page = new screen", () => {
  it("shows the same sessions, Client APIs and connected apps", async () => {
    const { userId, cookie } = await person();
    // `POST /api-clients` comes with §6 #4: the client is made the way the Server Action makes it.
    await createApiClientWith(await getAuth(), new Headers({ cookie }), {
      name: "Script",
      scopes: ["read", "write"],
    });
    const ctx = { userId };

    // What the server page read (`security/page.tsx` before R3), in the shape the screen draws.
    const page = {
      sessions: (await listOwnSessions(ctx)).map((session) => ({
        id: session.id,
        ...describeUserAgent(session.userAgent),
        ipAddress: session.ipAddress,
        createdAt: session.createdAt.toISOString(),
      })),
      clients: (await listApiClients(ctx)).map((client) => ({
        clientId: client.clientId,
        name: client.name,
        scopes: client.scopes,
        createdAt: client.createdAt.toISOString(),
      })),
      apps: await listConnectedApps(ctx),
    };

    // What the screen reads now.
    const { sessions } = await send("/sessions", cookie);
    const { clients } = await send("/api-clients", cookie);
    const { apps } = await send("/connected-apps", cookie);

    expect(page.clients).toHaveLength(1);
    expect({
      sessions,
      clients: clients.map(({ clientId, name, scopes, createdAt }: Record<string, unknown>) => ({
        clientId,
        name,
        scopes,
        createdAt,
      })),
      apps,
    }).toEqual({
      ...page,
      apps: page.apps.map((app) => ({ ...app, createdAt: app.createdAt.toISOString() })),
    });
  });
});

/** The rules the tests of `revokeSessionAction` held, on the route that replaced it. */
describe("Settings › Security, signing a session out", () => {
  it("signs out one of the person's own sessions", async () => {
    const alice = await person();
    const bob = await person();
    const { sessions } = await send("/sessions", alice.cookie);
    const own = sessions[0].id as string;
    await send(`/sessions/${own}`, alice.cookie, { method: "DELETE" });
    const afterwards = await api.fetch(
      new Request(`${origin()}/api/v1/sessions`, { headers: { cookie: alice.cookie } }),
    );
    expect(afterwards.status).toBe(401);
    expect(((await send("/sessions", bob.cookie)) as { sessions: unknown[] }).sessions).toHaveLength(1);
  });

  it("answers a session that is not the person's as one already gone, and leaves it alone", async () => {
    const alice = await person();
    const bob = await person();
    const { sessions } = await send("/sessions", bob.cookie);
    const response = await api.fetch(
      new Request(`${origin()}/api/v1/sessions/${sessions[0].id}`, {
        method: "DELETE",
        headers: { cookie: alice.cookie, origin: origin(), [SESSION_CSRF_HEADER]: "1" },
      }),
    );
    expect(response.status).toBe(204);
    expect(((await send("/sessions", bob.cookie)) as { sessions: unknown[] }).sessions).toHaveLength(1);
  });
});
