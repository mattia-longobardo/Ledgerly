import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createAccount, saveBalanceEntry } from "@domain/modules/accounts/service";
import type { IncomingTransaction } from "@domain/modules/transactions/rules";
import { upsertFromProvider } from "@domain/modules/transactions/service";
import { authAccounts } from "@domain/platform/auth/schema";
import type { Ctx } from "@domain/platform/context";
import { getDb } from "@domain/platform/db/client";
import { deleteFolder, listFolder } from "@domain/platform/storage";
import { saveConnection } from "@domain/platform/integrations/service/connections";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { WALLET_PROVIDER } from "@domain/platform/integrations/rules";
import { BACKFILL_CHOICES } from "@domain/platform/integrations/wallet/depth";

// `after()` needs a Next request scope. The reading of a document is not what these tests are
// about — the upload's ownership is — so it is a no-op here, deterministically.
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { api, reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const { resetRateLimits, MAX_PER_WINDOW } = await import("./rate-limit");
const { getAuth, invalidateAuth } = await import("@domain/platform/auth/auth");
const { createApiClientWith, deleteApiClient } = await import("@/platform/auth/api-clients");

const ORIGIN = "http://127.0.0.1:3000";
const PASSWORD = "correct-horse-battery";

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

/** The session of each person, which is what a Client API is created with. */
const sessions = new Map<string, Headers>();

/** A signed-in person whose only door is SSO (the password row removed), so no TOTP is owed. */
async function newContext(): Promise<Ctx> {
  const auth = await getAuth();
  const email = `${randomUUID()}@example.test`;
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "API" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  const jar = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="));
  sessions.set(created.user.id, new Headers({ cookie: jar.join("; ") }));
  return contextFor(created.user.id);
}

/** The id of the Client API behind each access token, so a test can delete it. */
const clientOf = new Map<string, string>();

/** An access token for `/api/v1` from a new Client API of the person (client_credentials). */
async function tokenFor(ctx: Ctx, scopes: string[] = ["read", "write", "imports"]): Promise<string> {
  const auth = await getAuth();
  const minted = await createApiClientWith(auth, sessions.get(ctx.userId)!, { name: "test", scopes });
  const response = await auth.handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
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
  clientOf.set(token, minted.clientId);
  return token;
}

async function call(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return api.fetch(new Request(`http://ledgerly.test/api/v1${path}`, { ...init, headers }));
}

async function anAccount(ctx: Ctx, name = "ING Conto Arancio"): Promise<string> {
  const account = await createAccount(ctx, {
    name,
    type: "checking",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: null,
    notes: "",
    openingBalance: null,
  });
  return account.id;
}

function movement(overrides: Partial<IncomingTransaction> = {}): IncomingTransaction {
  return {
    externalId: "w-1",
    counterpartExternalId: null,
    occurredAt: new Date(),
    amountCents: -2_500n,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    payee: "Esselunga",
    note: null,
    categoryExternalId: null,
    categoryName: null,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
    ...overrides,
  };
}

/** The smallest thing the sniffer accepts as a payslip: a PDF header is all it looks at. */
function aPdf(marker: string): File {
  const bytes = new TextEncoder().encode(`%PDF-1.4\n% ${marker}\n%%EOF\n`);
  return new File([bytes], `${marker}.pdf`, { type: "application/pdf" });
}

let alice: Ctx;
let bob: Ctx;
let aliceToken: string;
let bobToken: string;
let aliceAccount: string;

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  await resetRateLimits();
  sessions.clear();
  clientOf.clear();
  alice = await newContext();
  bob = await newContext();
  aliceToken = await tokenFor(alice);
  bobToken = await tokenFor(bob);
  aliceAccount = await anAccount(alice);
});

afterAll(closeDatabase);

describe("the gate", () => {
  it("refuses a call with no token, a malformed one, an unknown one and a former PAT", async () => {
    const pat = `pat_abcdefgh.${"A".repeat(43)}`;
    for (const token of [null, "not-a-token", "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln", pat]) {
      const response = await call("/summary", token);
      expect(response.status, String(token)).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("refuses a token that does not carry the scope, with 403 and not 401", async () => {
    const readOnly = await tokenFor(alice, ["read"]);
    const response = await call(`/accounts/${aliceAccount}/balances`, readOnly, {
      method: "POST",
      body: JSON.stringify({ on: "2026-09-21", balance: "100.00" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(403);
  });

  it("answers 404 for a path that does not exist", async () => {
    expect((await call("/nothing-here", aliceToken)).status).toBe(404);
  });

  it("stops a token that will not stop, and says how long to wait", async () => {
    for (let i = 0; i < MAX_PER_WINDOW; i += 1) await call("/summary", aliceToken);
    const response = await call("/summary", aliceToken);
    expect(response.status).toBe(429);
    // A token keeps 120 a minute: the web session's own allowance (H57) is not a token's.
    expect(response.headers.get("x-ratelimit-limit")).toBe("120");
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another token has its own window: one runaway script does not lock everyone out.
    expect((await call("/summary", bobToken)).status).toBe(200);
  });
});

describe("GET /accounts", () => {
  it("shows B none of A's accounts", async () => {
    const body = await (await call("/accounts", bobToken)).json();
    expect(body.accounts).toEqual([]);
  });
});

describe("the IBAN of an account (rewrite plan N4, H45)", () => {
  it("is in no answer of the accounts, neither whole nor masked", async () => {
    // An example IBAN of the standard, written by hand on the account.
    const iban = "IT60X0542811101000000123456";
    await createAccount(alice, {
      name: "Savings box",
      type: "savings",
      currency: "EUR",
      color: null,
      reference: "",
      iban,
      purpose: "",
      openedOn: null,
      notes: "",
      openingBalance: null,
    });
    const text = await (await call("/accounts", aliceToken)).text();
    expect(text).toContain("Savings box");
    expect(text).not.toContain(iban);
    expect(text).not.toContain("3456");
    expect(text.toLowerCase()).not.toContain("iban");
  });
});

describe("GET /accounts/:id/balances", () => {
  it("is not found for B, who may not even learn that A's account exists", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, bobToken);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
  });
});

describe("POST /accounts/:id/balances", () => {
  const reading = {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on: "2026-09-20", balance: "742.10" }),
  };

  it("refuses to write into A's account with B's token, and writes nothing", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, bobToken, reading);
    expect(response.status).toBe(404);
    const body = await (await call(`/accounts/${aliceAccount}/balances`, aliceToken)).json();
    expect(body.balances).toEqual([]);
  });

  it("refuses a body that is not a reading", async () => {
    const response = await call(`/accounts/${aliceAccount}/balances`, aliceToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ on: "not-a-date" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("GET /transactions", () => {
  beforeEach(async () => {
    await upsertFromProvider(alice, aliceAccount, [movement()], { provider: WALLET_PROVIDER });
  });

  it("shows B nothing of A's, even asking for A's account by id", async () => {
    const body = await (await call(`/transactions?account=${aliceAccount}`, bobToken)).json();
    expect(body.transactions).toEqual([]);
    expect(body.summary.count).toBe(0);
  });

  it("refuses a filter that is not one", async () => {
    expect((await call("/transactions?from=yesterday", aliceToken)).status).toBe(400);
  });
});

describe("GET /summary", () => {
  it("tells B about B, whatever A owns", async () => {
    // A balance of a month ago, whatever today is: a date written by hand is in the past only for a while.
    const on = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    await saveBalanceEntry(alice, aliceAccount, { on, cents: 5_000_00n });
    const body = await (await call("/summary", bobToken)).json();
    expect(body.accounts).toBe(0);
    expect(body.netWorth).toBeNull();
  });
});

describe("POST /imports", () => {
  function upload(marker: string): RequestInit {
    const form = new FormData();
    form.set("kind", "payslip");
    form.set("file", aPdf(marker));
    return { method: "POST", body: form };
  }

  it("files the document under the token's owner, never under anybody else", async () => {
    const response = await call("/imports", bobToken, upload("bobs-payslip"));
    expect(response.status).toBe(201);
    const { id } = await response.json();

    const { requireDocument } = await import("@domain/modules/imports/service");
    await expect(requireDocument(alice, id)).rejects.toMatchObject({ code: "not_found" });
    expect((await requireDocument(bob, id)).id).toBe(id);
  });

  it("recognises the same file sent twice as one document", async () => {
    await call("/imports", aliceToken, upload("twice"));
    const second = await call("/imports", aliceToken, upload("twice"));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ duplicate: true });
  });

  it("refuses a file that is not a document of a kind it knows", async () => {
    const form = new FormData();
    form.set("kind", "payslip");
    form.set("file", new File([new TextEncoder().encode("hello")], "note.txt"));
    const response = await call("/imports", aliceToken, { method: "POST", body: form });
    expect(response.status).toBe(415);
  });

  /*
    Release N6 (decisions H19, ST-26): a fund reads no document. The two kinds stay in the contract
    so that a caller gets a declared refusal, and nothing of the file is kept.
  */
  it("refuses a fund's document with 415 and keeps nothing of it, while a payslip still uploads", async () => {
    const { documents } = await import("@domain/modules/imports/schema");
    const stored = async () => [
      ...(await listFolder(`payslips/${alice.userId}/`)),
      ...(await listFolder(`cometa/${alice.userId}/`)),
    ];
    for (const kind of ["cometa_operations", "cometa_position"]) {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", aPdf(`a-fund-document-${kind}`));
      const response = await call("/imports", aliceToken, { method: "POST", body: form });
      expect(response.status, kind).toBe(415);
      expect(await response.json(), kind).toEqual({ error: "unsupported_format" });
    }
    expect(await getDb().select().from(documents)).toEqual([]);
    expect(await stored()).toEqual([]);

    try {
      const response = await call("/imports", aliceToken, upload("still-a-payslip"));
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ kind: "payslip", duplicate: false });
      expect((await getDb().select().from(documents)).map((row) => [row.userId, row.kind])).toEqual([
        [alice.userId, "payslip"],
      ]);
      expect(await stored()).toHaveLength(1);
    } finally {
      await deleteFolder(`payslips/${alice.userId}/`);
    }
  });

  it("refuses a token without the imports scope", async () => {
    const readOnly = await tokenFor(alice, ["read"]);
    expect((await call("/imports", readOnly, upload("refused"))).status).toBe(403);
  });
});

describe("users and settings: profile and preferences", () => {
  const json = (body: unknown): RequestInit => ({
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("reads and changes some preferences, the rest stays", async () => {
    const before = await (await call("/preferences", aliceToken)).json();
    const response = await call("/preferences", aliceToken, json({ theme: "dark", minutesPerDay: 450 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...before, theme: "dark", minutesPerDay: 450 });
    expect((await (await call("/preferences", bobToken)).json()).theme).toBe(before.theme);
  });

  it("refuses an unknown field, an unknown zone and a token without write", async () => {
    expect((await call("/preferences", aliceToken, json({ colour: "red" }))).status).toBe(400);
    expect((await call("/preferences", aliceToken, json({ timeZone: "Nowhere/Town" }))).status).toBe(400);
    const readOnly = await tokenFor(alice, ["read"]);
    expect((await call("/preferences", readOnly, json({ theme: "dark" }))).status).toBe(403);
  });

  it("reads and renames the person of the token", async () => {
    const profile = await (await call("/profile", aliceToken)).json();
    expect(profile).toMatchObject({ id: alice.userId, name: "API", managedByProvider: false });
    const renamed = await call("/profile", aliceToken, json({ name: "  Alex  " }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ id: alice.userId, name: "Alex" });
    expect((await (await call("/profile", bobToken)).json()).name).toBe("API");
  });
});

describe("users and settings: categories and labels", () => {
  const send = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const group = { name: "Home", parentId: null, type: "expense", color: null };

  it("creates, changes, archives, restores and deletes a category of the token's person only", async () => {
    const created = await call("/categories", aliceToken, send("POST", group));
    expect(created.status).toBe(201);
    const { id } = await created.json();
    const renamed = await call(`/categories/${id}`, aliceToken, send("PATCH", { ...group, name: "House" }));
    expect(await renamed.json()).toMatchObject({ id, name: "House", depth: 0, usage: 0, archivedAt: null });
    expect((await call(`/categories/${id}`, bobToken, send("PATCH", group))).status).toBe(404);
    const archived = await call(`/categories/${id}/archive`, aliceToken, send("POST"));
    expect(await archived.json()).toEqual({ ids: [id] });
    expect((await call("/categories/restore", aliceToken, send("POST", { ids: [id] }))).status).toBe(204);
    const names = (await (await call("/categories", aliceToken)).json()).categories.map(
      (c: { name: string }) => c.name,
    );
    expect(names).toContain("House");
    const deleted = await call(`/categories/${id}`, aliceToken, send("DELETE"));
    expect(await deleted.json()).toEqual({ removed: 1, uncategorised: 0, external: { state: "not_linked" } });
  });

  it("refuses a second category with the same name as a conflict", async () => {
    expect((await call("/categories", aliceToken, send("POST", group))).status).toBe(201);
    const again = await call("/categories", aliceToken, send("POST", group));
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "conflict", reason: "duplicate" });
  });

  it("creates, changes and deletes a label", async () => {
    const created = await call("/labels", aliceToken, send("POST", { name: "Trip", color: "#3366cc" }));
    const { id } = await created.json();
    const changed = await call(`/labels/${id}`, aliceToken, send("PATCH", { name: "Trips", color: null }));
    expect(await changed.json()).toEqual({ id, name: "Trips", color: null, usage: 0 });
    expect((await call(`/labels/${id}`, aliceToken, send("DELETE"))).status).toBe(204);
    expect((await (await call("/labels", aliceToken)).json()).labels).toEqual([]);
  });

  it("tells what a move to another macro changes, and merges two categories with an Undo", async () => {
    const first = await (await call("/categories", aliceToken, send("POST", group))).json();
    const second = await (
      await call("/categories", aliceToken, send("POST", { ...group, name: "Flat" }))
    ).json();
    const facts = await call(`/categories/${first.id}/macro-move`, aliceToken);
    expect(await facts.json()).toMatchObject({ from: "expense", count: 0, amount: "0.00", sources: [] });
    const merged = await (
      await call("/categories/merge", aliceToken, send("POST", { keepId: first.id, dropId: second.id }))
    ).json();
    expect(merged.moved).toBe(0);
    const undone = await call("/categories/merge/undo", aliceToken, send("POST", { undo: merged.undo }));
    expect(await undone.json()).toEqual({ moved: 0 });
    expect((await (await call("/source-categories", aliceToken)).json()).sourceCategories).toEqual([]);
  });
});

describe("the routes of the scopes security and admin", () => {
  it("answer 403 or 404 to every token, until the change of the authorization server grants them", async () => {
    const { SETTINGS_ROUTES } = await import("@ledgerly/api-contract");
    const guarded = SETTINGS_ROUTES.filter((route) => route.scope === "security" || route.scope === "admin");
    expect(guarded).toHaveLength(29);
    const every = await tokenFor(alice, ["read", "write", "imports", "investments:read"]);
    for (const route of guarded) {
      const path = route.path.replace(/\{\w+\}/g, alice.userId);
      const response = await call(path, every, {
        method: route.method,
        headers: { "content-type": "application/json" },
        body: route.method === "GET" || route.method === "DELETE" ? undefined : "{}",
      });
      expect([403, 404], `${route.method} ${route.path}`).toContain(response.status);
    }
  });
});

describe("users and settings: connections", () => {
  const send = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  it("lists a connection of the core with what its card does, and keeps it to its person", async () => {
    expect(await (await call("/connections", aliceToken)).json()).toEqual({ connections: [] });
    const { id } = await saveConnection(alice, { provider: "wallet", credentials: { token: "test-token" } });
    const [row] = (await (await call("/connections", aliceToken)).json()).connections;
    expect(row).toMatchObject({
      id,
      provider: "wallet",
      providerName: expect.stringMatching(/./),
      state: "active",
      providerActive: true,
      runs: [],
    });
    expect(row.capabilities).toEqual({
      sync: true,
      test: true,
      disconnect: true,
      chooseAccounts: true,
      renew: false,
      historyMonths: [...BACKFILL_CHOICES],
    });
    const empty = await call(
      "/connections",
      aliceToken,
      send("POST", { provider: "wallet", credentials: {} }),
    );
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: "invalid", reason: "empty" });
    const nobody = await call(
      "/connections",
      aliceToken,
      send("POST", { provider: "example", credentials: {} }),
    );
    expect(nobody.status).toBe(409);
    expect(await nobody.json()).toEqual({ error: "conflict", reason: "not_by_credentials" });
    expect((await call(`/connections/${id}`, bobToken, send("DELETE"))).status).toBe(404);
    expect((await call(`/connections/${id}/test`, bobToken, send("POST"))).status).toBe(404);
    const schedule = { rules: [{ kind: "times", times: ["07:30"], days: { kind: "every" } }] };
    expect((await call(`/connections/${id}/schedule`, aliceToken, send("PUT", schedule))).status).toBe(204);
    expect((await call(`/connections/${id}/schedule`, bobToken, send("PUT", schedule))).status).toBe(404);
    const preview = await call(`/connections/${id}/schedule/preview`, aliceToken, send("POST", schedule));
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({
      next: expect.arrayContaining([expect.any(String)]),
      problems: [],
    });
    expect((await call(`/connections/${id}/schedule/preview`, bobToken, send("POST", schedule))).status).toBe(
      404,
    );
    expect((await call(`/connections/${id}/sync`, aliceToken, send("POST"))).status).toBe(202);
    expect((await call(`/connections/${id}`, aliceToken, send("DELETE"))).status).toBe(204);
    expect(await (await call("/connections", aliceToken)).json()).toEqual({ connections: [] });
  });

  it("answers not found for a source or a plugin the person does not have", async () => {
    expect((await call("/sources/nothing/deactivation", aliceToken)).status).toBe(404);
    expect((await call("/plugins/nothing", aliceToken, send("PATCH", { active: true }))).status).toBe(404);
    expect((await call("/banks?country=it", aliceToken)).status).toBe(400);
  });
});

describe("parity of users and settings: route = MCP tool", () => {
  it("answers each read tool with what its route answers", async () => {
    await saveConnection(alice, { provider: "wallet", credentials: { token: "test-token" } });
    await call("/labels", aliceToken, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Trip", color: null }),
    });
    expect(reads.map((tool) => tool.name).sort()).toEqual([
      "get_account_balances",
      "get_fund",
      "get_funds",
      "get_interest_rule",
      "get_investment",
      "get_investment_holdings",
      "get_payroll",
      "get_payslip",
      "get_preferences",
      "get_profile",
      "get_spending",
      "get_summary",
      "get_time_off",
      "list_accounts",
      "list_budgets",
      "list_categories",
      "list_connections",
      "list_interest_rules",
      "list_investments",
      "list_labels",
      "list_pockets",
      "list_subscriptions",
      "list_transactions",
    ]);
    const paths: Record<string, string> = {
      get_preferences: "/preferences",
      get_profile: "/profile",
      list_categories: "/categories",
      list_connections: "/connections",
      list_labels: "/labels",
    };
    // Accounts', transactions', budgets', pockets', subscriptions', interests' and time off's tools are
    // held to their routes by `accounts.itest.ts`, `transactions.itest.ts`, `budgets.itest.ts`,
    // `pockets.itest.ts`, `subscriptions.itest.ts`, `interests.itest.ts` and `timeoff.itest.ts`.
    for (const tool of reads.filter((one) => one.name in paths)) {
      const route = await (await call(paths[tool.name], aliceToken)).json();
      expect(await tool.run(alice, {}), tool.name).toEqual(route);
    }
  });
});

describe("the routes of security, people and server, behind a guard that lets the person through", () => {
  // No token has the scopes yet (git-policy §6 #4): the handlers are proved with a guard of the test.
  const as = (ctx: Ctx) =>
    apiRoutes({
      ...adapters,
      guard: () => async (context, next) => {
        context.set("ctx", ctx);
        await next();
      },
    });
  const send = (app: ReturnType<typeof as>, method: string, path: string, body?: unknown) =>
    app.request(path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it("lists and ends the person's own sessions, and lists the people to an admin only", async () => {
    const app = as({ ...alice, role: "admin" });
    const sessions = (await (await send(app, "GET", "/sessions")).json()).sessions;
    expect(sessions.length).toBeGreaterThan(0);
    expect((await send(as(bob), "DELETE", `/sessions/${sessions[0].id}`)).status).toBe(204);
    expect((await (await send(app, "GET", "/sessions")).json()).sessions).toHaveLength(sessions.length);
    expect((await send(app, "DELETE", `/sessions/${sessions[0].id}`)).status).toBe(204);
    expect((await (await send(app, "GET", "/sessions")).json()).sessions).toHaveLength(sessions.length - 1);
    const people = (await (await send(app, "GET", "/people")).json()).people;
    expect(people.map((one: { id: string }) => one.id)).toEqual(
      expect.arrayContaining([alice.userId, bob.userId]),
    );
    expect((await send(as(bob), "GET", "/people")).status).toBe(403);
  });

  it("answers a refused run of a connection with a reason of the contract's closed list", async () => {
    const { CONNECTION_REFUSALS } = await import("@ledgerly/api-contract");
    const id = randomUUID();
    for (const [refusal, reason] of [
      ["notActive", "not_active"],
      ["busy", "busy"],
      ["consent_expired", "consent_expired"],
      ["network", "failed"],
    ]) {
      const app = apiRoutes({
        ...adapters,
        connections: { ...adapters.connections, run: async () => ({ ok: false, refusal, found: true }) },
        guard: () => async (context, next) => {
          context.set("ctx", alice);
          await next();
        },
      });
      const response = await send(app, "POST", `/connections/${id}/sync`);
      expect(response.status, refusal).toBe(409);
      expect(await response.json()).toEqual({ error: "conflict", reason });
      expect(CONNECTION_REFUSALS).toContain(reason);
    }
  });

  it("refuses to remove the admin who asks, and reads the settings of the server", async () => {
    const app = as({ ...alice, role: "admin" });
    const self = await send(app, "DELETE", `/people/${alice.userId}`);
    expect(self.status).toBe(409);
    const settings = await (await send(app, "GET", "/server/settings")).json();
    expect(settings).toMatchObject({
      llm: null,
      oidc: { displayName: null, environmentOrigin: "http://127.0.0.1:9" },
      maintenance: { backupsKept: 30, nextVersion: expect.any(String) },
    });
    expect((await send(app, "POST", "/server/jobs/nothing/run")).status).toBe(404);
  });
});

describe("a deleted Client API", () => {
  it("stops its token on every route at once", async () => {
    await deleteApiClient(alice, clientOf.get(aliceToken)!);
    for (const path of ["/accounts", "/transactions", "/summary"]) {
      expect((await call(path, aliceToken)).status, path).toBe(401);
    }
  });
});
