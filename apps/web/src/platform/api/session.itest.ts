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
import { deleteFolder } from "@domain/platform/storage";
import { previewSchedule } from "@domain/platform/integrations/schedule";
import { closeDatabase, resetDatabase } from "../../../../../test/db";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api, reads } = await import("@/app/api/v1/[[...route]]/composition");
const { MAX_PER_WINDOW, resetRateLimits, SESSION_MAX_PER_WINDOW, takeSlot } = await import("./rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { createApiClientWith } = await import("@/platform/auth/api-clients");
const { readEnv } = await import("@domain/platform/env");
const { engineService } = await import("../../../../../test/investments");
const { contextFor } = await import("../../../../../test/fixtures");

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
  init: { method?: string; body?: unknown; form?: FormData; origin?: string | null; csrf?: boolean } = {},
): Promise<Response> {
  const method = init.method ?? "GET";
  // A browser's call: it always says where it comes from (`apiRead` of the web's server does not).
  const headers = new Headers({ "sec-fetch-site": "same-origin" });
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
        body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
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

  it("gives the session its own allowance: past a token's 120 a minute, stopped at 1200 (H57)", async () => {
    for (let i = 0; i <= MAX_PER_WINDOW; i += 1) await takeSlot(`user:${alice.userId}`);
    const past = await call("/profile", alice);
    expect(past.status).toBe(200);
    expect(past.headers.get("x-ratelimit-limit")).toBe(String(SESSION_MAX_PER_WINDOW));
    // The window's other slots taken directly: 1200 requests through the app would only be slower.
    const left = Number(past.headers.get("x-ratelimit-remaining"));
    for (let i = 0; i < left; i += 1)
      await takeSlot(`user:${alice.userId}`, new Date(), SESSION_MAX_PER_WINDOW);
    const stopped = await call("/profile", alice);
    expect(stopped.status).toBe(429);
    expect(Number(stopped.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts the reads of the web's server in a window of their own, stopped at 1200 too (H57)", async () => {
    const fromServer = () =>
      api.fetch(new Request(`${origin()}/api/v1/profile`, { headers: { cookie: alice.cookie } }));
    for (let i = 0; i < SESSION_MAX_PER_WINDOW; i += 1)
      await takeSlot(`user:${alice.userId}`, new Date(), SESSION_MAX_PER_WINDOW);
    expect((await call("/profile", alice)).status).toBe(429);
    const server = await fromServer();
    expect(server.status).toBe(200);
    expect(server.headers.get("x-ratelimit-limit")).toBe(String(SESSION_MAX_PER_WINDOW));
    const left = Number(server.headers.get("x-ratelimit-remaining"));
    for (let i = 0; i < left; i += 1)
      await takeSlot(`user:${alice.userId}:web`, new Date(), SESSION_MAX_PER_WINDOW);
    const stopped = await fromServer();
    expect(stopped.status).toBe(429);
    expect(Number(stopped.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("gives admin to an admin only", async () => {
    expect((await call("/people", alice)).status).toBe(403);
    expect((await call("/server/settings", alice)).status).toBe(403);
    const admin = await signedIn({ role: "admin" });
    expect((await call("/people", admin)).status).toBe(200);
    expect((await call("/server/settings", admin)).status).toBe(200);
  });

  it("marks the session of the cookie as the current one", async () => {
    const { sessions: own } = await (await call("/sessions", alice)).json();
    expect(own.filter((one: { current: boolean }) => one.current)).toHaveLength(1);
  });

  it("answers the sign-in, the Profile options and the server's facts with no secret nor value of the environment", async () => {
    const admin = await signedIn({ role: "admin" });
    const provider = new URL(readEnv().OIDC_DISCOVERY_URL);
    const signIn = await (await call("/security/sign-in", admin)).json();
    expect(signIn).toEqual({
      password: false,
      sso: false,
      identityProvider: provider.origin,
      twoFactorPolicy: readEnv().TWO_FACTOR_POLICY,
    });
    const options = await (await call("/profile/options", admin)).json();
    expect(options.monthlySummaryAllowed).toBe(true);
    expect(options.timeZones).toContainEqual({ zone: "Asia/Tokyo", offset: "UTC+9" });
    const settings = await (await call("/server/settings", admin)).json();
    expect(settings.oidc.environmentOrigin).toBe(provider.origin);
    expect(settings.maintenance).toMatchObject({ nextVersion: expect.any(String), export: null });

    const secrets = Object.entries(process.env)
      // An `_ID` names a key without being one (the S3 key id can be the app's name, as the client id is).
      .filter(
        ([name, value]) => /SECRET|PASSWORD|TOKEN|DATABASE_URL|KEY$/.test(name) && (value ?? "").length >= 8,
      )
      .map(([name, value]) => [name, value!] as const);
    expect(secrets.length).toBeGreaterThan(0);
    for (const path of ["/security/sign-in", "/profile/options", "/server/settings", "/server/diagnostics"]) {
      const text = await (await call(path, admin)).text();
      for (const [name, value] of secrets) expect(text.includes(value), `${path} ${name}`).toBe(false);
      if (path !== "/server/settings") expect(text.includes(provider.href), path).toBe(false);
    }
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

  it("gives the IBAN and the switch's masked identifiers to the session only, never to a token (H45)", async () => {
    // An example IBAN of the standard, nobody's account.
    const iban = "IT60X0542811101000000123456";
    const created = await call("/accounts", alice, {
      method: "POST",
      body: { name: "Savings box", type: "savings", iban },
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const ibanPath = `/accounts/${id}/iban`;
    const identifiersPath = `/accounts/${id}/switch/identifiers`;

    const read = await call(ibanPath, alice);
    expect(read.status).toBe(200);
    expect(await read.json()).toEqual({ iban: "IT60 X054 2811 1010 0000 0123 456" });
    const identifiers = await call(identifiersPath, alice);
    expect(identifiers.status).toBe(200);
    expect(await identifiers.json()).toEqual({ identifiers: [] });

    // Every scope a token can be granted, alone or with the cookie: 403, and no IBAN in the answer.
    const token = await tokenFor(alice, ["read", "write", "imports", "investments:read"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      for (const path of [ibanPath, identifiersPath]) {
        const refused = await call(path, who);
        expect(refused.status).toBe(403);
        const text = await refused.text();
        expect(text).not.toContain(iban.slice(4));
        expect(text).not.toContain("3456");
      }
    }
    // No token can ask for `session`, and no MCP tool reads either route.
    await expect(tokenFor(alice, ["read", "session"])).rejects.toThrow();
    expect(reads.filter((tool) => tool.scope === "session")).toEqual([]);
    expect(reads.map((tool) => tool.name)).not.toContain("get_account_iban");
    expect(reads.map((tool) => tool.name)).not.toContain("list_switch_identifiers");
  });

  it("gives the Connection of a service and the routes that carry a key to the session only (SEC-08)", async () => {
    const { accountId } = await engineService(contextFor(alice.userId), {
      name: "Directa",
      category: "broker",
      currency: "EUR",
    });
    const routes = [
      { method: "GET", path: `/investments/${accountId}/connection` },
      {
        method: "POST",
        path: "/investments/connections",
        body: { provider: "nope", credentials: {}, target: { kind: "existing", accountId } },
      },
      { method: "PUT", path: `/investments/${accountId}/key`, body: { credentials: { api_key: "x" } } },
    ];
    // The session reaches each use case: the tab, an unknown provider, a service with no key.
    const answers = [];
    for (const route of routes) answers.push(await call(route.path, alice, route));
    expect(answers.map((answer) => answer.status)).toEqual([200, 400, 409]);
    expect(await answers[1].json()).toEqual({ error: "invalid", reason: "unknown_provider" });
    expect(await answers[2].json()).toEqual({ error: "conflict", reason: "not_connected" });
    // A token with every scope it can be granted: 403, with or without the cookie.
    const token = await tokenFor(alice, ["read", "write", "imports", "investments:read"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      for (const route of routes) expect((await call(route.path, who, route)).status, route.path).toBe(403);
    }
    // No MCP tool reads or writes any of them.
    const names = reads.map((tool) => tool.name);
    for (const name of [
      "get_investment_connection",
      "connect_investment_provider",
      "replace_investment_key",
    ]) {
      expect(names).not.toContain(name);
    }
  });

  it("gives a plugin's state and its application's credentials to the session only", async () => {
    const routes = [
      { method: "PATCH", path: "/plugins/enablebanking", body: { active: true } },
      {
        method: "PUT",
        path: "/plugins/enablebanking/credentials",
        body: { applicationId: "app", privateKey: "key" },
      },
      { method: "DELETE", path: "/plugins/enablebanking/credentials" },
    ];
    // The session reaches each use case.
    const answers = [];
    for (const route of routes) answers.push((await call(route.path, alice, route)).status);
    expect(answers.filter((status) => status === 401 || status === 403)).toEqual([]);
    const nothing = await call("/plugins/nothing", alice, { method: "PATCH", body: { active: true } });
    expect(nothing.status).toBe(404);
    // A token with every scope it can be granted: 403, with or without the cookie.
    const token = await tokenFor(alice, ["read", "write", "imports", "investments:read"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      for (const route of routes) expect((await call(route.path, who, route)).status, route.path).toBe(403);
    }
    const names = reads.map((tool) => tool.name);
    for (const name of ["set_plugin_active", "save_plugin_credentials", "remove_plugin_credentials"]) {
      expect(names).not.toContain(name);
    }
  });

  it("lets only the session ask the LLM fallback for a payslip, never a token", async () => {
    const path = `/payroll/payslips/${randomUUID()}/llm-fill`;
    // The session reaches the use case: no fallback is configured on the test instance.
    const asked = await call(path, alice, { method: "POST" });
    expect(asked.status).toBe(503);
    expect(await asked.json()).toEqual({ error: "unavailable", reason: "llm_not_configured" });
    // A token with every scope it can be granted, `write` among them: 403, with or without the cookie.
    const token = await tokenFor(alice, ["read", "write", "imports", "investments:read"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      expect((await call(path, who, { method: "POST" })).status).toBe(403);
    }
    expect(reads.map((tool) => tool.name)).not.toContain("fill_payslip_with_llm");
  });

  /*
    R2 imports: the session gets `imports`, so the Payroll screen uploads through `POST /imports`.
    It gets that scope and no other new one, and no token gains a scope from it.
  */
  it("gives the session imports and no other scope it did not have", async () => {
    const form = new FormData();
    form.set("kind", "payslip");
    form.set("file", new File([new TextEncoder().encode("%PDF-1.4\n% session\n%%EOF\n")], "session.pdf"));
    try {
      const uploaded = await call("/imports", alice, { method: "POST", form });
      expect(uploaded.status).toBe(201);
      expect(await uploaded.json()).toMatchObject({ kind: "payslip", duplicate: false });
    } finally {
      await deleteFolder(`payslips/${alice.userId}/`);
    }
    // `admin` stays an admin's.
    expect((await call("/people", alice)).status).toBe(403);
  });

  /*
    R2 investments: the session gets `investments:read`, so the Investments screens read `/api/v1`.
    A token without it still gets 403, with or without the cookie, and no token gains a scope.
  */
  it("gives the session investments:read and refuses it to a token without the scope", async () => {
    expect((await call("/investments", alice)).status).toBe(200);
    const token = await tokenFor(alice, ["read", "write", "imports"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      expect((await call("/investments", who)).status).toBe(403);
    }
  });

  it("refuses POST /imports with 403 to a token without imports, and gives no token a new scope", async () => {
    const form = () => {
      const data = new FormData();
      data.set("kind", "payslip");
      data.set("file", new File([new TextEncoder().encode("%PDF-1.4\n% token\n%%EOF\n")], "token.pdf"));
      return data;
    };
    const token = await tokenFor(alice, ["read", "write", "investments:read"]);
    for (const who of [{ bearer: token }, { bearer: token, cookie: alice.cookie }]) {
      const refused = await call("/imports", who, {
        method: "POST",
        form: form(),
        origin: null,
        csrf: false,
      });
      expect(refused.status).toBe(403);
    }
    // What only the session has is never granted to a token.
    for (const scope of ["security", "session", "admin"]) {
      await expect(tokenFor(alice, ["read", scope]), scope).rejects.toThrow();
    }
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
      { provider: "plugin:wallet", credentials: { token: "test-token" } },
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
      { provider: "plugin:wallet", credentials: { token: "test-token" } },
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

// R3 parity of the writes that need the browser's session (03-releases.md §R3, criterion 11; §6 #4):
// a Client API and the access to a bank. What the Server Action's use case answered is what the route answers.
describe("the writes made inside the person's session", () => {
  it("makes a Client API, answers its secret once, and refuses what the action refused", async () => {
    const made = await call("/api-clients", alice, {
      method: "POST",
      body: { name: "Home", scopes: ["read"] },
    });
    expect(made.status).toBe(201);
    const minted = await made.json();
    expect(minted).toEqual({
      clientId: expect.any(String),
      clientSecret: expect.any(String),
      tokenEndpoint: `${origin()}/api/auth/oauth2/token`,
      resource: `${origin()}/api/v1`,
    });
    const { clients } = await (await call("/api-clients", alice)).json();
    expect(clients.map((one: { clientId: string; name: string }) => [one.clientId, one.name])).toEqual([
      [minted.clientId, "Home"],
    ]);
    // The action's `invalid`: a name the rule refuses, a scope no Client API may have.
    for (const body of [
      { name: " ", scopes: ["read"] },
      { name: "Home", scopes: ["security"] },
    ]) {
      await expect(
        createApiClientWith(await getAuth(), new Headers({ cookie: alice.cookie }), body),
      ).rejects.toMatchObject({ code: "invalid" });
      const refused = await call("/api-clients", alice, { method: "POST", body });
      expect(refused.status).toBe(400);
      expect(await refused.json()).toEqual({ error: "invalid" });
    }
    // A token is never granted `security`: it cannot make a client with its own.
    const token = await tokenFor(alice, ["read", "write"]);
    expect(
      (
        await call(
          "/api-clients",
          { bearer: token },
          { method: "POST", body: { name: "X", scopes: ["read"] } },
        )
      ).status,
    ).toBe(403);
  });

  it("starts and renews the access to a bank with the answers of the action's use case", async () => {
    const { renewBankAccess, startBankAccess } = await import("@/app/(app)/banks/connect/cases");
    const [own] = await getDb()
      .select({ id: sessions.id })
      .from(sessions)
      .where(eq(sessions.userId, alice.userId));
    const ctx = contextFor(alice.userId);
    const institution = { country: "IT", name: "Example Bank" };
    const asRoute = (outcome: { ok: true } | { ok: false; error: string }) =>
      outcome.ok ? 201 : outcome.error === "not_found" ? 404 : outcome.error;
    const started = await call("/banks/access", alice, { method: "POST", body: institution });
    const before = await startBankAccess(ctx, own.id, institution);
    expect(started.status === 409 ? (await started.json()).reason : started.status).toBe(asRoute(before));

    const missing = randomUUID();
    const renewed = await call(`/connections/${missing}/renew`, alice, { method: "POST" });
    expect(renewed.status).toBe(asRoute(await renewBankAccess(ctx, own.id, missing)));

    // The input the action refused as `failed` is the contract's `invalid`.
    expect(
      (await call("/banks/access", alice, { method: "POST", body: { country: "it", name: "X" } })).status,
    ).toBe(400);
    // An access is bound to a browser's session: a token has none.
    const token = await tokenFor(alice, ["read", "write"]);
    const byToken = await call("/banks/access", { bearer: token }, { method: "POST", body: institution });
    expect(byToken.status).toBe(409);
    expect(await byToken.json()).toEqual({ error: "conflict", reason: "no_session" });
  });
});
