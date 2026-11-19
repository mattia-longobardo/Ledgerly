// The web's session cookie on `/api/v1` (rewrite plan R4, `platform/api/auth.ts`): the scopes it
// gets, the CSRF proof on writes, the rules of a page (TOTP setup, revoked, blocked), the Bearer
// that decides alone, no CORS answer, and the preview of a schedule.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_CSRF_HEADER } from "@ledgerly/api-contract";
import { authAccounts, sessions, users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { saveConnection } from "@domain/platform/integrations/service/connections";
import { previewSchedule } from "@domain/platform/integrations/schedule";
import { closeDatabase, resetDatabase } from "../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api } = await import("@/app/api/v1/[[...route]]/composition");
const { resetRateLimits } = await import("./rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { createApiClientWith } = await import("@/platform/auth/api-clients");
const { readEnv } = await import("@domain/platform/env");

const PASSWORD = "correct-horse-battery";

interface Person {
  userId: string;
  cookie: string;
}

/**
 * A signed-in person and their cookie. `owesTotp`: the password stays, so under the default
 * TWO_FACTOR_POLICY=required the session still owes its TOTP setup; otherwise the password row is
 * removed (an SSO-only person), so the session opens the app.
 */
async function signedIn({ role = "user", owesTotp = false } = {}): Promise<Person> {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({
    body: { email, password: PASSWORD, name: "Session", role: role as "user" | "admin" },
  });
  // The first person of an instance is its admin: the role is set, whatever the order.
  await getDb().update(users).set({ role }).where(eq(users.id, created.user.id));
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  if (!owesTotp) {
    await getDb()
      .delete(authAccounts)
      .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  }
  const cookie = headers
    .getSetCookie()
    .map((one) => one.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  return { userId: created.user.id, cookie };
}

const origin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

/** A call the way the web makes it: the cookie, and on a write the instance's origin and the header. */
function call(
  path: string,
  who: { cookie?: string; bearer?: string },
  init: { method?: string; body?: unknown; origin?: string | null; csrf?: boolean } = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  const headers = new Headers();
  if (who.cookie) headers.set("cookie", who.cookie);
  if (who.bearer) headers.set("authorization", `Bearer ${who.bearer}`);
  const write = method !== "GET";
  const sentOrigin = init.origin === undefined ? (write ? origin() : null) : init.origin;
  if (sentOrigin) headers.set("origin", sentOrigin);
  if (init.csrf ?? write) headers.set(SESSION_CSRF_HEADER, "1");
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return Promise.resolve(
    api.fetch(
      new Request(`${origin()}/api/v1${path}`, {
        method,
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    ),
  );
}

async function tokenFor(person: Person, scopes: string[]): Promise<string> {
  const auth = await getAuth();
  const minted = await createApiClientWith(auth, new Headers({ cookie: person.cookie }), {
    name: "test",
    scopes,
  });
  const response = await auth.handler(
    new Request(`${origin()}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${minted.clientId}:${minted.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource: minted.resource }).toString(),
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

let alice: Person;

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
  alice = await signedIn();
});

afterAll(closeDatabase);

describe("the session cookie on /api/v1", () => {
  it("reads and writes users and settings with read, write and security", async () => {
    expect((await call("/profile", alice)).status).toBe(200);
    expect((await call("/preferences", alice)).status).toBe(200);
    const renamed = await call("/profile", alice, { method: "PATCH", body: { name: "Alex" } });
    expect(renamed.status).toBe(200);
    expect((await (await call("/profile", alice)).json()).name).toBe("Alex");
    expect((await call("/preferences", alice, { method: "PATCH", body: { theme: "dark" } })).status).toBe(
      200,
    );
    expect((await call("/sessions", alice)).status).toBe(200);
    expect((await call("/api-clients", alice)).status).toBe(200);
    expect((await call("/connections", alice)).status).toBe(200);
  });

  it("gives admin to an admin only", async () => {
    expect((await call("/people", alice)).status).toBe(403);
    expect((await call("/server/settings", alice)).status).toBe(403);
    const admin = await signedIn({ role: "admin" });
    expect((await call("/people", admin)).status).toBe(200);
    expect((await call("/server/settings", admin)).status).toBe(200);
  });

  it("refuses a write without the instance's Origin or without the header, with 403", async () => {
    const body = { name: "Mallory" };
    for (const init of [
      { origin: "https://evil.example" },
      { origin: null },
      { csrf: false },
      { origin: "https://evil.example", csrf: false },
    ]) {
      const response = await call("/profile", alice, { method: "PATCH", body, ...init });
      expect(response.status, JSON.stringify(init)).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    expect((await (await call("/profile", alice)).json()).name).toBe("Session");
  });

  it("opens nothing to a session that owes its TOTP setup, a revoked one or a blocked person", async () => {
    const pending = await signedIn({ owesTotp: true });
    expect((await call("/profile", pending)).status).toBe(401);
    expect((await call("/profile", pending, { method: "PATCH", body: { name: "x" } })).status).toBe(401);

    const revoked = await signedIn();
    await getDb().delete(sessions).where(eq(sessions.userId, revoked.userId));
    expect((await call("/profile", revoked)).status).toBe(401);

    // Blocking deletes the sessions too; the flag alone already closes a session that outlived it.
    const blocked = await signedIn();
    await getDb().update(users).set({ banned: true }).where(eq(users.id, blocked.userId));
    expect((await call("/profile", blocked)).status).toBe(401);

    expect((await call("/profile", {})).status).toBe(401);
  });

  it("lets the Bearer decide alone: as before, and a bad one is not saved by a cookie", async () => {
    const token = await tokenFor(alice, ["read"]);
    expect((await call("/profile", { bearer: token })).status).toBe(200);
    // A write by token needs no CSRF proof, but the token's scope.
    expect(
      (
        await call(
          "/profile",
          { bearer: token },
          { method: "PATCH", body: { name: "x" }, origin: null, csrf: false },
        )
      ).status,
    ).toBe(403);
    expect((await call("/sessions", { bearer: token })).status).toBe(403);
    expect((await call("/profile", { bearer: "not-a-token", cookie: alice.cookie })).status).toBe(401);
    // With both, the token's scopes count, not the session's.
    expect((await call("/sessions", { bearer: token, cookie: alice.cookie })).status).toBe(403);
  });

  it("never answers with Access-Control-Allow-Credentials, nor a preflight", async () => {
    const responses = [
      await call("/profile", alice, { origin: "https://evil.example" }),
      await call("/profile", alice, { method: "PATCH", body: { name: "x" }, origin: "https://evil.example" }),
      await call("/profile", {}),
      await api.fetch(
        new Request(`${origin()}/api/v1/profile`, {
          method: "OPTIONS",
          headers: { origin: "https://evil.example", "access-control-request-method": "PATCH" },
        }),
      ),
    ];
    for (const response of responses) {
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("POST /connections/{id}/schedule/preview", () => {
  async function preview(person: Person, id: string, schedule: unknown) {
    return call(`/connections/${id}/schedule/preview`, person, { method: "POST", body: schedule });
  }

  it("answers the domain's next times and problems, and saves nothing", async () => {
    const { id } = await saveConnection(
      { userId: alice.userId },
      { provider: "wallet", credentials: { token: "test-token" } },
    );
    const before = await (await call("/connections", alice)).json();
    const timeZone: string = (await (await call("/preferences", alice)).json()).timeZone;
    const cases: Record<string, { rules: unknown[] }> = {
      valid: { rules: [{ kind: "times", times: ["07:30", "19:00"], days: { kind: "every" } }] },
      conflicting: {
        rules: [
          { kind: "times", times: ["07:00"], days: { kind: "every" } },
          { kind: "times", times: ["07:10"], days: { kind: "weekdays", weekdays: [1, 2, 3, 4, 5] } },
        ],
      },
      tooClose: { rules: [{ kind: "cron", expression: "0,5 * * * *" }] },
    };
    for (const [name, schedule] of Object.entries(cases)) {
      const response = await preview(alice, id, schedule);
      expect(response.status, name).toBe(200);
      const body = await response.json();
      const expected = previewSchedule(schedule.rules, timeZone, new Date(), 5);
      expect(body.problems, name).toEqual(expected.problems);
      expect(body.next, name).toEqual(expected.next.map((instant) => instant.toISOString()));
      if (name === "valid") expect(body.next).toHaveLength(5);
      else expect(body.problems[0].code, name).toBe("tooFrequent");
    }
    const never = await preview(alice, id, { rules: [{ kind: "cron", expression: "0 0 31 2 *" }] });
    expect((await never.json()).problems).toEqual([{ code: "neverRuns", rule: 0 }]);
    expect(await (await call("/connections", alice)).json()).toEqual(before);
  });

  // An interval under MIN_SYNC_GAP_MINUTES does not parse, as in the editor today: no times, 400.
  it("refuses an interval under the minimum gap, another person's connection and a cross-site call", async () => {
    const { id } = await saveConnection(
      { userId: alice.userId },
      { provider: "wallet", credentials: { token: "test-token" } },
    );
    const tooOften = {
      rules: [{ kind: "interval", everyMinutes: 5, from: "00:00", until: "23:59", days: { kind: "every" } }],
    };
    expect((await preview(alice, id, tooOften)).status).toBe(400);
    const bob = await signedIn();
    expect((await preview(bob, id, { rules: [] })).status).toBe(404);
    const crossSite = await call(`/connections/${id}/schedule/preview`, alice, {
      method: "POST",
      body: { rules: [] },
      origin: "https://evil.example",
    });
    expect(crossSite.status).toBe(403);
  });
});
