// `/api/v1` with the web's session cookie (03-releases.md §R4, git-policy §6 #4): same origin only,
// the person's scopes, a write only with its `Origin` and the session header, never CORS. A token of
// a Client API keeps only its own scopes.
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { authAccounts, users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { readEnv } from "@domain/platform/env";
import { SESSION_HEADER } from "@ledgerly/api-contract";
import { closeDatabase, resetDatabase } from "../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api } = await import("@/app/api/v1/[[...route]]/composition");
const { resetRateLimits } = await import("./rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { createApiClientWith } = await import("@/platform/auth/api-clients");

const PASSWORD = "correct-horse-battery";

interface Person {
  id: string;
  cookie: string;
}

/** A signed-in person whose only door is SSO (the password row removed), so no TOTP is owed. */
async function aPerson(role: "user" | "admin" = "user"): Promise<Person> {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "Web" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  // The first person of an empty database is its admin: the role is set either way.
  await getDb().update(users).set({ role }).where(eq(users.id, created.user.id));
  const cookie = headers
    .getSetCookie()
    .map((one) => one.split(";")[0])
    .filter((pair) => !pair.endsWith("="))
    .join("; ");
  return { id: created.user.id, cookie };
}

const appOrigin = () => new URL(readEnv().BETTER_AUTH_URL).origin;

async function call(
  path: string,
  headers: Record<string, string>,
  init: RequestInit = {},
): Promise<Response> {
  return api.fetch(new Request(`${appOrigin()}/api/v1${path}`, { ...init, headers }));
}

/** What the web sends: the cookie, the header and, for a write, its own origin. */
function web(person: Person, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: person.cookie, [SESSION_HEADER]: "1", "content-type": "application/json", ...extra };
}

const patchName = (name: string): RequestInit => ({ method: "PATCH", body: JSON.stringify({ name }) });

let alice: Person;

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
  alice = await aPerson();
});

afterAll(closeDatabase);

describe("the web's session on /api/v1", () => {
  it("reads the preferences and changes the profile with the cookie, from the app's origin", async () => {
    const read = await call("/preferences", web(alice));
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ locale: expect.any(String) });

    const write = await call("/profile", web(alice, { origin: appOrigin() }), patchName("Alice Web"));
    expect(write.status).toBe(200);
    expect(await (await call("/profile", web(alice))).json()).toMatchObject({ name: "Alice Web" });
  });

  it("refuses the cookie without the session header, as it did before", async () => {
    for (const init of [{}, patchName("x")]) {
      const response = await call("/profile", { cookie: alice.cookie, origin: appOrigin() }, init);
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toMatch(/^Bearer resource_metadata=/);
    }
  });

  it("refuses a write without its origin, and any call from another origin", async () => {
    expect((await call("/profile", web(alice), patchName("x"))).status).toBe(403);
    for (const origin of ["https://evil.example", "null"]) {
      expect((await call("/profile", web(alice, { origin }), patchName("x"))).status, origin).toBe(403);
      expect((await call("/preferences", web(alice, { origin }))).status, origin).toBe(403);
    }
    const crossSite = await call("/preferences", web(alice, { "sec-fetch-site": "cross-site" }));
    expect(crossSite.status).toBe(403);
    expect(crossSite.headers.get("access-control-allow-origin")).toBeNull();
    expect(await (await call("/profile", web(alice))).json()).toMatchObject({ name: "Web" });
  });

  it("answers no CORS header to the cookie, even from the app's origin", async () => {
    const response = await call("/preferences", web(alice, { origin: appOrigin() }));
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("refuses a header with no session, or a session that is gone", async () => {
    expect((await call("/preferences", { [SESSION_HEADER]: "1" })).status).toBe(401);
    expect(
      (await call("/preferences", web({ id: alice.id, cookie: "better-auth.session_token=forged" }))).status,
    ).toBe(401);
  });

  it("gives the person `security`, and `admin` only to an admin, checked at every call", async () => {
    expect((await call("/sessions", web(alice))).status).toBe(200);
    expect((await call("/people", web(alice))).status).toBe(403);

    const admin = await aPerson("admin");
    expect((await call("/people", web(admin))).status).toBe(200);
    await getDb().update(users).set({ role: "user" }).where(eq(users.id, admin.id));
    expect((await call("/people", web(admin))).status).toBe(403);
  });

  it("keeps a Client API's token to its own scopes: no `security`, no `admin`, even for an admin", async () => {
    const admin = await aPerson("admin");
    const auth = await getAuth();
    const minted = await createApiClientWith(auth, new Headers({ cookie: admin.cookie }), {
      name: "third party",
      scopes: ["read", "write"],
    });
    const response = await auth.handler(
      new Request(`${appOrigin()}/api/auth/oauth2/token`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          authorization: `Basic ${Buffer.from(`${minted.clientId}:${minted.clientSecret}`).toString("base64")}`,
        },
        body: new URLSearchParams({ grant_type: "client_credentials", resource: minted.resource }).toString(),
      }),
    );
    expect(response.status).toBe(200);
    const token = ((await response.json()) as { access_token: string }).access_token;
    const bearer = { authorization: `Bearer ${token}` };
    expect((await call("/preferences", bearer)).status).toBe(200);
    for (const path of ["/sessions", "/people"]) {
      const refused = await call(path, bearer);
      expect(refused.status, path).toBe(403);
      expect(refused.headers.get("www-authenticate"), path).toContain('error="insufficient_scope"');
    }
    // The token wins over the cookie: the session does not lend it its scopes.
    expect((await call("/sessions", { ...web(admin), ...bearer })).status).toBe(403);
  });
});
