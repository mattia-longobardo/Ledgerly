// Investments on /api/v1 and on the MCP (docs/design/investments.md §5.5, SEC-08; §7 row "5 ·
// Esposizione e rendimento"): the scope `investments:read` is required and `read` does not imply it,
// and no answer carries a key, a key check, a connection's last error or a provider's external id —
// checked with canary values planted in every one of those places.
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import type {
  HoldingsSnapshot,
  InvestmentSource,
  ProviderEvent,
} from "@/platform/integrations/investments/source";
import { integrationConnections, providerLinks } from "@/platform/integrations/schema";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { contextFor } from "../../../test/fixtures";
import { authAccounts } from "@/platform/auth/schema";

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/server", () => ({ after: () => {} }));

const { getAuth, invalidateAuth } = await import("@/platform/auth/auth");
const { createApiClient } = await import("@/platform/auth/api-clients");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { api } = await import("@/platform/api/app");
const { handleMcp } = await import("@/platform/mcp/handler");
const { createManualService, recordOperation } = await import("./service");
const { connectInvestmentProvider, setSourcesForTests } = await import("./sync");

const ORIGIN = "http://127.0.0.1:3000";
const API = `${ORIGIN}/api/v1`;
const MCP = `${ORIGIN}/api/mcp`;
const PASSWORD = "correct-horse-battery";
const ACCEPT = "application/json, text/event-stream";

const CANARY = {
  apiKey: "canary-exposure-api-key-3f9d",
  userKey: "canary-exposure-user-key-c21a",
  account: "canary-ext-account-77b1",
  instrument: "canary-ext-instrument-5e0c",
  deposit: "canary-ext-deposit-a4d2",
  lastError: "canary-last-error-91ab",
};

const READ_SCOPES = ["etoro-public:trade.real:read", "etoro-public:money.balance:read"];

function fakeSource(): InvestmentSource {
  return {
    async verifyReadOnly() {
      return {
        result: "read-only",
        permissions: Object.fromEntries(READ_SCOPES.map((scope) => [scope, true])),
        ipRestricted: null,
        externalAccountId: CANARY.account,
      };
    },
    async fetchHoldings(): Promise<HoldingsSnapshot> {
      return {
        observedAt: new Date(),
        externalAccountId: CANARY.account,
        totalCents: 150_000n,
        cashCents: 50_000n,
        positions: [
          {
            asset: {
              externalId: CANARY.instrument,
              class: "stock",
              name: "Apple",
              symbol: "AAPL",
              currency: "EUR",
            },
            product: "trading",
            quantity: "5",
            price: "200",
            priceCurrency: "EUR",
            priceSource: "etoro",
            valueCents: 100_000n,
          },
        ],
        scopes: [
          { product: "cash", complete: true },
          { product: "copy", complete: true },
          { product: "trading", complete: true },
        ],
        empty: false,
        complete: true,
      };
    },
    async fetchFlows(_credentials, now) {
      const deposit: ProviderEvent = {
        externalId: CANARY.deposit,
        occurredAt: new Date(now.getTime() - 300 * 86_400_000),
        note: null,
        legs: [
          {
            leg: "main",
            kind: "deposit",
            asset: null,
            product: null,
            quantity: null,
            unitPrice: null,
            priceCurrency: null,
            nativeAmount: "1000",
            nativeCurrency: "EUR",
          },
        ],
      };
      return {
        events: [deposit],
        coverage: [
          {
            stream: "deposits",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
    async fetchHistory(_credentials, _currency, now) {
      return {
        points: [],
        coverage: [
          {
            stream: "balance_history",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "gap",
            reason: "api_limit_12m",
          },
        ],
      };
    },
  };
}

function cookiesFrom(headers: Headers): Headers {
  const jar = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="));
  return new Headers({ cookie: jar.join("; ") });
}

/** A signed-in person whose only door is SSO, so no TOTP is owed (as in mcp.itest.ts). */
async function ssoPerson(email: string): Promise<Ctx> {
  const auth = await getAuth();
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "Exposure" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  requestHeaders = cookiesFrom(headers);
  return contextFor(created.user.id);
}

async function tokenFor(scopes: string[], resource: string): Promise<string> {
  const minted = await createApiClient({ name: "exposure", scopes });
  const response = await (
    await getAuth()
  ).handler(
    new Request(`${ORIGIN}/api/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${minted.clientId}:${minted.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "client_credentials", resource }).toString(),
    }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function get(path: string, token: string): Promise<Response> {
  return api.fetch(new Request(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } }));
}

let rpcId = 0;
async function rpc(token: string, method: string, params: unknown = {}) {
  return handleMcp(
    new Request(MCP, {
      method: "POST",
      headers: { accept: ACCEPT, "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    }),
  );
}

async function toolNames(token: string): Promise<string[]> {
  const response = await rpc(token, "tools/list");
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result: { tools: { name: string }[] } };
  return body.result.tools.map((tool) => tool.name).sort();
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(token, "tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  const body = (await response.json()) as { result: { content: { text: string }[]; isError?: boolean } };
  return { isError: body.result.isError ?? false, text: body.result.content[0].text };
}

/** Nothing of the connection may leave: no key, no external id, no last error, no sync state. */
function expectNothingSecret(text: string): void {
  for (const value of Object.values(CANARY)) expect(text).not.toContain(value);
  for (const key of [
    "lastError",
    "last_error",
    "externalId",
    "external_id",
    "credentials",
    "permissions",
    "state",
  ]) {
    expect(text).not.toContain(`"${key}"`);
  }
}

/** A connected eToro service and a manual one, with a canary last error on the connection. */
async function seed(ctx: Ctx): Promise<{ etoro: string; manual: string }> {
  const { accountId: etoro } = await connectInvestmentProvider(
    ctx,
    "etoro",
    { api_key: CANARY.apiKey, user_key: CANARY.userKey },
    { kind: "new", name: "eToro", currency: "EUR" },
  );
  // The deposit really carries its external id in provider_links: the answers must not show it.
  const links = await getDb()
    .select()
    .from(providerLinks)
    .where(eq(providerLinks.externalId, CANARY.deposit));
  expect(links).toHaveLength(1);
  await getDb()
    .update(integrationConnections)
    .set({ lastError: CANARY.lastError })
    .where(eq(integrationConnections.userId, ctx.userId));
  const { accountId: manual } = await createManualService(ctx, {
    target: "new",
    name: "Directa",
    category: "broker",
    currency: "EUR",
    mode: "total",
    url: null,
  });
  const on = today(ctx.timeZone);
  await recordOperation(ctx, manual, { kind: "deposit", on, amountCents: 100_000n });
  await recordOperation(ctx, manual, { kind: "account_valuation", on, amountCents: 105_000n });
  return { etoro, manual };
}

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  resetRateLimits();
  requestHeaders = new Headers();
  setSourcesForTests(() => fakeSource());
});

afterEach(() => setSourcesForTests(null));

afterAll(closeDatabase);

describe("/api/v1/investments (§5.5)", () => {
  it("needs investments:read: read alone is refused with insufficient_scope", async () => {
    const ctx = await ssoPerson("api-scope@example.test");
    const { etoro } = await seed(ctx);
    const token = await tokenFor(["read", "write", "imports"], API);
    for (const path of ["/investments", `/investments/${etoro}/holdings`]) {
      const response = await get(path, token);
      expect(response.status).toBe(403);
      expect(response.headers.get("www-authenticate")).toMatch(
        /error="insufficient_scope".*scope="investments:read"/,
      );
    }
    // The scope does not open the rest of the API either.
    const only = await tokenFor(["investments:read"], API);
    expect((await get("/accounts", only)).status).toBe(403);
  });

  it("lists the services and the portfolio with their returns, and nothing of the connection", async () => {
    const ctx = await ssoPerson("api-list@example.test");
    const { etoro, manual } = await seed(ctx);
    const token = await tokenFor(["investments:read"], API);

    const response = await get("/investments", token);
    expect(response.status).toBe(200);
    const text = await response.text();
    expectNothingSecret(text);
    const body = JSON.parse(text);
    expect(body.currency).toBe("EUR");
    const byId = new Map<string, Record<string, unknown>>(
      body.services.map((one: { accountId: string }) => [one.accountId, one]),
    );
    expect(byId.get(etoro)).toMatchObject({
      name: "eToro",
      provider: "etoro",
      origin: "synced",
      currency: "EUR",
      value: "1500.00",
      invested: "1000.00",
      gain: "500.00",
      simpleReturn: 0.5,
      xirrStatus: "ok",
      reliable: true,
    });
    expect(byId.get(manual)).toMatchObject({
      origin: "manual",
      value: "1050.00",
      invested: "1000.00",
      gain: "50.00",
      simpleReturn: 0.05,
      // +5 % in no time at all: no rate solves it, so XIRR is not computable (§2.4).
      xirr: null,
      xirrStatus: "no_solution",
    });
    // +50 % in 300 days: 1.5^(365/300) − 1.
    expect(byId.get(etoro)?.xirr as number).toBeCloseTo(Math.pow(1.5, 365 / 300) - 1, 4);
    expect(body.totals).toMatchObject({
      value: "2550.00",
      invested: "2000.00",
      gain: "550.00",
      simpleReturn: 0.275,
      xirrStatus: "ok",
      includesExchangeEffect: false,
    });

    const holdings = await get(`/investments/${etoro}/holdings`, token);
    expect(holdings.status).toBe(200);
    const holdingsText = await holdings.text();
    expectNothingSecret(holdingsText);
    expect(JSON.parse(holdingsText)).toMatchObject({
      accountId: etoro,
      currency: "EUR",
      holdings: [
        {
          asset: { name: "Apple", symbol: "AAPL", class: "stock" },
          product: "trading",
          origin: "provider",
          quantity: "5",
          value: "1000.00",
        },
      ],
    });
  });

  it("answers 404 for another person's service and 400 for a malformed id", async () => {
    const owner = await ssoPerson("api-owner@example.test");
    const { etoro } = await seed(owner);
    await ssoPerson("api-stranger@example.test");
    const token = await tokenFor(["investments:read"], API);
    expect((await get(`/investments/${etoro}/holdings`, token)).status).toBe(404);
    expect((await get("/investments/not-a-uuid/holdings", token)).status).toBe(400);
    const list = JSON.parse(await (await get("/investments", token)).text());
    expect(list.services).toEqual([]);
  });
});

describe("MCP list_investments and get_investment_holdings (§5.5)", () => {
  it("shows the tools only to a token with investments:read", async () => {
    const ctx = await ssoPerson("mcp-scope@example.test");
    await seed(ctx);
    const read = await tokenFor(["read"], MCP);
    const names = await toolNames(read);
    expect(names).not.toContain("list_investments");
    expect(names).not.toContain("get_investment_holdings");
    const refused = await callTool(read, "list_investments");
    expect(refused.isError).toBe(true);

    // investments:read alone opens the two Investments tools, and only them.
    const investments = await tokenFor(["investments:read"], MCP);
    expect(await toolNames(investments)).toEqual(["get_investment_holdings", "list_investments"]);
    const both = await tokenFor(["read", "investments:read"], MCP);
    expect(await toolNames(both)).toEqual([
      "get_account_balances",
      "get_investment_holdings",
      "get_summary",
      "list_accounts",
      "list_budgets",
      "list_investments",
      "list_transactions",
    ]);
  });

  it("answers the same figures as the API, with nothing of the connection", async () => {
    const ctx = await ssoPerson("mcp-tools@example.test");
    const { etoro } = await seed(ctx);
    const token = await tokenFor(["investments:read"], MCP);

    const list = await callTool(token, "list_investments");
    expect(list.isError).toBe(false);
    expectNothingSecret(list.text);
    expect(JSON.parse(list.text).totals).toMatchObject({ value: "2550.00", gain: "550.00" });

    const holdings = await callTool(token, "get_investment_holdings", { account_id: etoro });
    expect(holdings.isError).toBe(false);
    expectNothingSecret(holdings.text);
    expect(JSON.parse(holdings.text).holdings).toHaveLength(1);

    const foreign = await callTool(token, "get_investment_holdings", {
      account_id: "00000000-0000-7000-8000-000000000000",
    });
    expect(foreign).toEqual({ isError: true, text: "Investment service not found." });
  });
});
