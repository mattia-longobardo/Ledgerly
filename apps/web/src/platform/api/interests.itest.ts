// The routes of interests (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case
// through its route, the person's own data only, and action = route = MCP tool = export. The guard is
// the test's: `api.itest.ts` proves the tokens.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import type { PlainRule } from "@ledgerly/domain/interests";
import { startOfDayIn, today } from "@domain/shared/dates";
import { centsToDecimal } from "@domain/shared/money";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const interests = await import("@ledgerly/domain/interests");

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

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const routes = apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });
  const response = await routes.request(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? null : JSON.parse(text) };
}

let alice: Ctx;
let bob: Ctx;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
});

afterAll(closeDatabase);

const body = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  accountId,
  validFrom: "2026-01-01",
  validTo: null,
  runHour: null,
  tiers: [
    { upTo: "5000", rate: "3.65" },
    { upTo: null, rate: "1.5" },
  ],
  tax: "26",
  dayBasis: "365",
  settlement: "monthly",
  payeeMatch: null,
  mode: "analyze_only",
  categoryId: null,
  state: "active",
  ...overrides,
});

/** A manual savings account with a balance since 2025, and one rule on it. */
async function seed(ctx: Ctx, overrides: Record<string, unknown> = {}) {
  const created = await send(ctx, "POST", "/accounts", {
    name: "Savings",
    type: "savings",
    openingBalance: { on: "2025-12-01", amount: "10000" },
  });
  expect(created.status).toBe(201);
  const accountId = created.body.id as string;
  const rule = await send(ctx, "POST", "/interests", body(accountId, overrides));
  expect(rule.status, JSON.stringify(rule.body)).toBe(201);
  return { accountId, ruleId: rule.body.id as string };
}

describe("the routes of interests", () => {
  it("creates, accrues, changes and reads a rule of the person's own only", async () => {
    const { accountId, ruleId } = await seed(alice);
    const list = await send(alice, "GET", "/interests");
    expect(list.status).toBe(200);
    expect(list.body.rules).toHaveLength(1);
    expect(list.body.rules[0]).toMatchObject({
      id: ruleId,
      accountId,
      account: "Savings",
      tiers: [
        { upTo: "5000.00", rate: "3.65" },
        { upTo: null, rate: "1.5" },
      ],
      tax: "26",
      mode: "analyze_only",
      state: "active",
    });
    expect(Number(list.body.rules[0].accruedYtd)).toBeGreaterThan(0);
    expect(list.body.totals).toEqual({
      year: today(alice.timeZone).slice(0, 4),
      accruedYtd: list.body.rules[0].accruedYtd,
      grossYtd: list.body.rules[0].grossYtd,
    });
    expect(list.body.accounts).toEqual([{ id: accountId, name: "Savings", publishable: false }]);

    const detail = await send(alice, "GET", `/interests/${ruleId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.rule).toEqual(list.body.rules[0]);
    expect(detail.body.balance).toEqual({ synced: false, lastSyncedAt: null, staleForAccrual: false });
    expect(detail.body.settlements.length).toBeGreaterThan(0);
    expect(detail.body.settlements[0]).toMatchObject({ posting: "none", status: "no_data", paid: null });

    // Nothing of Alice's is Bob's.
    expect((await send(bob, "GET", "/interests")).body.rules).toEqual([]);
    expect((await send(bob, "GET", `/interests/${ruleId}`)).status).toBe(404);
    expect((await send(bob, "PUT", `/interests/${ruleId}`, body(accountId))).status).toBe(404);
    expect((await send(bob, "PUT", `/interests/${ruleId}/state`, { state: "paused" })).status).toBe(404);

    expect((await send(alice, "PUT", `/interests/${ruleId}`, body(accountId, { tax: "0" }))).status).toBe(
      204,
    );
    expect((await send(alice, "PUT", `/interests/${ruleId}/state`, { state: "paused" })).status).toBe(204);
    const after = (await send(alice, "GET", "/interests")).body.rules[0];
    expect(after).toMatchObject({ tax: "0", state: "paused", nextPayout: null });
  });

  it("answers the same year to date in the list and on the rule across a pause over the new year", async () => {
    // Paused from 20/12 to 05/01: on 03/01 the days of December still wait for their settlement.
    const noon = (day: string) => new Date(startOfDayIn(day, alice.timeZone).getTime() + 12 * 3_600_000);
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(noon("2025-12-20"));
      const { ruleId } = await seed(alice, { validFrom: "2025-12-01" });
      expect((await send(alice, "PUT", `/interests/${ruleId}/state`, { state: "paused" })).status).toBe(204);
      vi.setSystemTime(noon("2026-01-03"));

      const list = (await send(alice, "GET", "/interests")).body;
      const detail = (await send(alice, "GET", `/interests/${ruleId}`)).body;
      expect(Number(detail.accruedYtd)).toBeGreaterThan(0);
      expect(list.rules[0].accruedYtd).toBe(detail.accruedYtd);
      expect(detail.rule.accruedYtd).toBe(detail.accruedYtd);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses what is not a rate, a band, a reference of the person or an account that publishes", async () => {
    const { accountId } = await seed(alice);
    expect((await send(alice, "POST", "/interests", body(accountId, { tax: "101" }))).status).toBe(400);
    expect((await send(alice, "POST", "/interests", body(accountId, { tax: "26,5" }))).status).toBe(400);
    const unordered = [
      { upTo: "5000", rate: "1" },
      { upTo: "100", rate: "1" },
      { upTo: null, rate: "1" },
    ];
    expect((await send(alice, "POST", "/interests", body(accountId, { tiers: unordered }))).body).toEqual({
      error: "invalid",
      reason: "invalid_tiers",
    });
    expect((await send(bob, "POST", "/interests", body(accountId))).body).toEqual({
      error: "invalid",
      reason: "invalid_account",
    });
    // No rule publishes on its source since R5c (H37): a declared refusal, not a bad body.
    expect(await send(alice, "POST", "/interests", body(accountId, { mode: "post_to_provider" }))).toEqual({
      status: 422,
      body: { error: "mode_retired" },
    });
  });

  it("posts and marks only a settlement of the rule in the path", async () => {
    const { accountId, ruleId } = await seed(alice);
    const other = (await send(alice, "POST", "/interests", body(accountId, { validFrom: "2026-02-01" }))).body
      .id as string;
    const entryId = (await send(alice, "GET", `/interests/${ruleId}`)).body.settlements[0].id as string;
    const posting = `/interests/${ruleId}/settlements/${entryId}/posting`;
    // A rule that only computes publishes nothing: the answer says where the posting stands.
    expect(await send(alice, "POST", posting, { retry: false })).toEqual({
      status: 200,
      body: { posting: "none" },
    });
    expect(
      (await send(alice, "POST", `/interests/${other}/settlements/${entryId}/posting`, { retry: false }))
        .status,
    ).toBe(404);
    expect((await send(bob, "POST", posting, { retry: false })).status).toBe(404);
    // Only an unsure posting can be marked.
    expect((await send(alice, "PUT", `/interests/${ruleId}/settlements/${entryId}/posted`)).status).toBe(404);
  });
});

describe("parity of interests: action = route = MCP tool = export", () => {
  it("stores the rule the action stored from the same typed text", async () => {
    const { accountId } = await seed(alice);
    // The action reads the text in the person's number format on the server; the route takes the decimal.
    const byAction = await interests.createRule(
      alice,
      interests.ruleInputOf({
        ...body(accountId),
        tiers: [
          { upTo: centsToDecimal(parseAmount("5.000", alice.numberFormat)), rate: "3.65" },
          { upTo: null, rate: "1.5" },
        ],
      } as PlainRule),
    );
    const rows = (await send(alice, "GET", "/interests")).body.rules;
    expect(rows.map((row: { id: string }) => row.id)).toContain(byAction.id);
    expect({ ...rows[0], id: null }).toEqual({ ...rows[1], id: null });
  });

  it("answers both tools, the export and the pages with the same numbers", async () => {
    const { ruleId } = await seed(alice);
    const route = (await send(alice, "GET", "/interests")).body;
    const list = reads.find((one) => one.name === "list_interest_rules")!;
    expect(await list.run(alice, {})).toEqual(route);
    const detail = (await send(alice, "GET", `/interests/${ruleId}`)).body;
    const get = reads.find((one) => one.name === "get_interest_rule")!;
    expect(await get.run(alice, { rule_id: ruleId })).toEqual(detail);
    // The list page and the export read `interestsView`; the rule's page reads `ruleDetail`.
    const view = await interests.interestsView(alice);
    expect(
      view.map((row) => [centsToDecimal(row.accruedYtdCents), centsToDecimal(row.grossYtdCents)]),
    ).toEqual(
      route.rules.map((row: { accruedYtd: string; grossYtd: string }) => [row.accruedYtd, row.grossYtd]),
    );
    const page = await interests.ruleDetail(alice, ruleId);
    expect(centsToDecimal(page.accruedYtdCents)).toBe(detail.accruedYtd);
    expect(centsToDecimal(page.pendingCents)).toBe(detail.pending);
    // The list and the rule's page answer one year to date (`accruedYtd` of the domain).
    expect(detail.accruedYtd).toBe(detail.rule.accruedYtd);
  });
});
