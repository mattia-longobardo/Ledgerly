import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { deleteFolder, ensureBucket } from "@/platform/storage";
import { numbersSnapshot } from "../scripts/numbers-snapshot";
import { canonical } from "../scripts/snapshot-format";
import { closeDatabase, resetDatabase } from "../test/db";
import { contextFor } from "../test/fixtures";
import {
  REFERENCE_NOW,
  seedReferencePayslips,
  seedReferenceUser,
  type ReferenceUser,
} from "../test/reference-user";
import { authAccounts } from "./platform/auth/schema";

// The reference files of the rewrite plan (docs/design/rewrite-plan/10-modularity.md §10.10): what
// the read services (B2, the numbers snapshot), the REST API and the MCP tools (B4, the contract)
// answer about the reference user of `test/reference-user.ts`, with the clock stopped at
// `REFERENCE_NOW`. A refactor must leave every byte of `baselines/numbers/` and
// `baselines/contract/` as it is. A change that is meant — a new route, a decision that moves a
// number — rewrites them with `npm run test:integration -- src/baselines.itest.ts -u`, in a commit
// that says why.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/server", () => ({ after: () => {} }));

const { getAuth, invalidateAuth } = await import("./platform/auth/auth");
const { createApiClient } = await import("./platform/auth/api-clients");
const { resetRateLimits } = await import("./platform/api/rate-limit");
const { api } = await import("./platform/api/app");
const { handleMcp } = await import("./platform/mcp/handler");

const ORIGIN = "http://127.0.0.1:3000";
const MCP = `${ORIGIN}/api/mcp`;
const PASSWORD = "correct-horse-battery";
const BASELINES = join(process.cwd(), "baselines");

let ctx: Ctx;
let user: ReferenceUser;

/** A signed-in person whose only door is SSO, so no TOTP is owed (as in `api.itest.ts`). */
async function referencePerson(): Promise<Ctx> {
  const auth = await getAuth();
  const email = "reference@example.test";
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "Reference" } });
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
  requestHeaders = new Headers({ cookie: jar.join("; ") });
  return contextFor(created.user.id);
}

async function tokenFor(scopes: string[], resource: string): Promise<string> {
  const minted = await createApiClient({ name: `reference ${resource}`, scopes: scopes as never });
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

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

/**
 * The two things a run cannot repeat, made repeatable without losing what they say: an identifier
 * becomes its order of first appearance (so "the same account" is still the same), and an instant
 * the database stamped with its own clock — the only ones after `REFERENCE_NOW` — becomes `<now>`.
 */
function repeatable(answers: unknown): string {
  const seen = new Map<string, string>();
  return `${JSON.stringify(answers, null, 1)}\n`
    .replace(UUID, (id) => {
      const key = id.toLowerCase();
      if (!seen.has(key)) seen.set(key, `<id-${seen.size + 1}>`);
      return seen.get(key)!;
    })
    .replace(INSTANT, (instant) => (new Date(instant) > REFERENCE_NOW ? "<now>" : instant));
}

beforeAll(async () => {
  await ensureBucket();
  await resetDatabase();
  invalidateAuth();
  resetRateLimits();
  // Only `Date` is faked: the pool's own timers must keep running.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(REFERENCE_NOW);
  ctx = await referencePerson();
  // The payslips go through the bucket, and S3 refuses a request signed five years from now: they
  // are read with the real clock, between the sign-in and everything else. None of their numbers
  // comes from the clock.
  vi.useRealTimers();
  await seedReferencePayslips(ctx);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(REFERENCE_NOW);
  user = await seedReferenceUser(ctx, (instant) => vi.setSystemTime(instant));
}, 120_000);

afterAll(async () => {
  vi.useRealTimers();
  await deleteFolder("payslips/");
  await resetDatabase();
  await closeDatabase();
});

describe("the reference user", () => {
  it("has the same numbers as the reference file, twice in a row (B2)", async () => {
    const first = canonical(await numbersSnapshot(ctx, REFERENCE_NOW));
    const second = canonical(await numbersSnapshot(ctx, REFERENCE_NOW));
    expect(second).toBe(first);
    await expect(first).toMatchFileSnapshot(join(BASELINES, "numbers/reference.json"));
  });

  it("gets the same answers from every route of /api/v1 (B4)", async () => {
    const token = await tokenFor(["read", "write", "imports", "investments:read"], `${ORIGIN}/api/v1`);
    const call = async (method: string, path: string, body?: unknown) => {
      const response = await api.fetch(
        new Request(`http://ledgerly.test/api/v1${path}`, {
          method,
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        }),
      );
      return { status: response.status, body: await response.json() };
    };
    const answers: Record<string, unknown> = {};
    for (const path of [
      "/accounts",
      `/accounts/${user.checkingId}/balances`,
      `/accounts/${user.checkingId}/balances?limit=2`,
      "/transactions?from=2031-09-01&to=2031-10-15",
      `/transactions?account=${user.checkingId}&type=income&limit=2`,
      "/summary",
      "/investments",
      "/investments?period=all",
      `/investments/${user.brokerId}/holdings`,
      "/nothing-here",
    ]) {
      answers[`GET ${path}`] = await call("GET", path);
    }
    // Last, because it writes: the answer of the one writing route that needs no file.
    answers[`POST /accounts/${user.savingsId}/balances`] = await call(
      "POST",
      `/accounts/${user.savingsId}/balances`,
      { on: "2031-10-15", balance: "12050.00" },
    );
    await expect(repeatable(answers)).toMatchFileSnapshot(join(BASELINES, "contract/api.json"));
  });

  it("gets the same answers from every MCP tool, and the same list of tools (B4)", async () => {
    const token = await tokenFor(["read", "investments:read"], MCP);
    let rpcId = 0;
    const rpc = async (method: string, params: unknown) => {
      const response = await handleMcp(
        new Request(MCP, {
          method: "POST",
          headers: {
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: (rpcId += 1), method, params }),
        }),
      );
      expect(response.status).toBe(200);
      return ((await response.json()) as { result: unknown }).result;
    };
    const tool = async (name: string, args: Record<string, unknown> = {}) => {
      const result = (await rpc("tools/call", { name, arguments: args })) as {
        content: { text: string }[];
        isError?: boolean;
      };
      return { isError: result.isError ?? false, answer: JSON.parse(result.content[0].text) as unknown };
    };
    const answers: Record<string, unknown> = { "tools/list": await rpc("tools/list", {}) };
    answers.get_summary = await tool("get_summary");
    answers.list_accounts = await tool("list_accounts");
    answers.get_account_balances = await tool("get_account_balances", {
      account_id: user.checkingId,
      limit: 3,
    });
    answers.list_transactions = await tool("list_transactions", { from: "2031-09-01", to: "2031-10-15" });
    answers.list_budgets = await tool("list_budgets", { month: "2031-10" });
    answers.list_investments = await tool("list_investments", { period: "all" });
    answers.get_investment_holdings = await tool("get_investment_holdings", { account_id: user.brokerId });
    await expect(repeatable(answers)).toMatchFileSnapshot(join(BASELINES, "contract/mcp.json"));
  });
});
