import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, contextFor, newContext } from "../../../test/fixtures";
import { authAccounts } from "../auth/schema";

// The MCP server (docs/auth-design.md D6) against the real plugin and database: the RFC 9728
// challenge, the audience, the scope, the protocol round trip and — above all — that a token
// only ever sees its own person's data.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/server", () => ({ after: () => {} }));

const { getAuth, invalidateAuth } = await import("../auth/auth");
const { createApiClient } = await import("../auth/api-clients");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { createToken } = await import("@/platform/tokens/service");
const { saveBalanceEntry } = await import("@/modules/accounts/service");
const { handleMcp } = await import("./handler");

const ORIGIN = "http://127.0.0.1:3000";
const API = `${ORIGIN}/api/v1`;
const MCP = `${ORIGIN}/api/mcp`;
const PASSWORD = "correct-horse-battery";
const ACCEPT = "application/json, text/event-stream";

function cookiesFrom(headers: Headers): Headers {
  const jar = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="));
  return new Headers({ cookie: jar.join("; ") });
}

/** A signed-in person whose only door is SSO, so no TOTP is owed (as in oauth.itest.ts). */
async function ssoPerson(email = "mcp@example.test"): Promise<{ userId: string; headers: Headers }> {
  const auth = await getAuth();
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "MCP" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  return { userId: created.user.id, headers: cookiesFrom(headers) };
}

async function tokenFor(scopes: ("read" | "write" | "imports")[], resource = MCP): Promise<string> {
  const minted = await createApiClient({ name: "mcp", scopes });
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

let rpcId = 0;

async function rpc(token: string | null, method: string, params: unknown = {}, httpMethod = "POST") {
  const headers = new Headers({ accept: ACCEPT, "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return handleMcp(
    new Request(MCP, {
      method: httpMethod,
      headers,
      body:
        httpMethod === "POST" ? JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) : undefined,
    }),
  );
}

async function callTool(token: string, name: string, args: Record<string, unknown> = {}) {
  const response = await rpc(token, "tools/call", { name, arguments: args });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    result: { content: { type: string; text: string }[]; isError?: boolean };
  };
  return { isError: body.result.isError ?? false, text: body.result.content[0].text };
}

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  resetRateLimits();
  requestHeaders = new Headers();
});

afterAll(closeDatabase);

describe("MCP authorization", () => {
  it("answers 401 with the RFC 9728 challenge without a token", async () => {
    const response = await rpc(null, "initialize");
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    expect(response.headers.get("access-control-expose-headers")).toMatch(/WWW-Authenticate/);
  });

  it("refuses a forged token, a token for /api/v1 and a personal access token", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const forged = await rpc("eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln", "initialize");
    expect(forged.status).toBe(401);
    expect(forged.headers.get("www-authenticate")).toMatch(
      /^Bearer error="invalid_token", resource_metadata=/,
    );

    const forApi = await tokenFor(["read"], API);
    expect((await rpc(forApi, "initialize")).status).toBe(401);

    const pat = await createToken(contextFor(person.userId), {
      name: "legacy",
      scopes: ["read"],
      expiresInDays: 30,
    });
    expect((await rpc(pat.token, "initialize")).status).toBe(401);
  });

  it("answers 403 insufficient_scope to a token that cannot read", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const token = await tokenFor(["imports"]);
    const response = await rpc(token, "initialize");
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toMatch(/error="insufficient_scope".*scope="read"/);
  });

  it("answers 405 to GET and DELETE: the server is stateless", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const token = await tokenFor(["read"]);
    for (const method of ["GET", "DELETE"]) {
      const response = await rpc(token, "", {}, method);
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    }
  });

  it("refuses a body over 1 MB even without a Content-Length (PERS-49 SEC-09)", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const token = await tokenFor(["read"]);
    const chunk = new TextEncoder().encode(" ".repeat(64 * 1024));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"x":"'),
        );
        for (let i = 0; i < 20; i += 1) controller.enqueue(chunk);
        controller.enqueue(new TextEncoder().encode('"}}'));
        controller.close();
      },
    });
    const response = await handleMcp(
      new Request(MCP, {
        method: "POST",
        headers: { accept: ACCEPT, "content-type": "application/json", authorization: `Bearer ${token}` },
        body,
        duplex: "half",
      } as RequestInit),
    );
    expect(response.status).toBe(413);
  });

  it("answers the CORS preflight without a token", async () => {
    const response = await handleMcp(new Request(MCP, { method: "OPTIONS" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
  });
});

describe("MCP tools", () => {
  it("initializes without a session and lists the read-only v1 tools", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const token = await tokenFor(["read", "write"]);

    const init = await rpc(token, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "itest", version: "1" },
    });
    expect(init.status).toBe(200);
    expect(init.headers.get("mcp-session-id")).toBeNull();
    const initBody = (await init.json()) as { result: { serverInfo: { name: string } } };
    expect(initBody.result.serverInfo.name).toBe("ledgerly");

    const list = await rpc(token, "tools/list");
    const tools = ((await list.json()) as { result: { tools: { name: string; annotations?: unknown }[] } })
      .result.tools;
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "get_account_balances",
      "get_summary",
      "list_accounts",
      "list_budgets",
      "list_transactions",
    ]);
    for (const tool of tools) expect(tool.annotations).toMatchObject({ readOnlyHint: true });
  });

  it("reads the token owner's data and never another person's", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const ctx = contextFor(person.userId);
    const mine = await anAccount(ctx, "Mine");
    await saveBalanceEntry(ctx, mine, { on: "2026-01-15", cents: 123456n, note: "" });
    const stranger = await newContext();
    const theirs = await anAccount(stranger, "Theirs");
    await saveBalanceEntry(stranger, theirs, { on: "2026-01-15", cents: 999n, note: "" });

    const token = await tokenFor(["read"]);

    const accounts = JSON.parse((await callTool(token, "list_accounts")).text) as {
      accounts: { id: string; name: string }[];
    };
    expect(accounts.accounts.map((account) => account.id)).toEqual([mine]);

    const balances = await callTool(token, "get_account_balances", { account_id: mine });
    expect(balances.isError).toBe(false);
    expect(JSON.parse(balances.text).balances[0].balance).toBe("1234.56");

    // Another person's account is not found, not forbidden: its existence is not disclosed.
    const foreign = await callTool(token, "get_account_balances", { account_id: theirs });
    expect(foreign).toEqual({ isError: true, text: "Account not found." });

    const transactions = JSON.parse(
      (await callTool(token, "list_transactions", { account_id: theirs })).text,
    );
    expect(transactions.transactions).toEqual([]);

    const summary = JSON.parse((await callTool(token, "get_summary")).text);
    expect(summary).toHaveProperty("netWorth");

    const budgets = JSON.parse((await callTool(token, "list_budgets", { month: "2026-01" })).text);
    expect(budgets).toMatchObject({ month: "2026-01-01", budgets: [] });
  });

  it("rejects arguments outside the schema", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const token = await tokenFor(["read"]);
    const bad = await callTool(token, "get_account_balances", { account_id: "not-a-uuid" });
    expect(bad.isError).toBe(true);
  });
});
