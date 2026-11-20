// The routes of pockets (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case through
// its route, the person's own data only, and action = route = MCP tool = export = Overview's tile
// (POC-1: one balance). The guard is the test's: `api.itest.ts` proves the tokens.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const pockets = await import("@ledgerly/domain/pockets");

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

async function account(ctx: Ctx, name: string, opening: string): Promise<string> {
  const created = await send(ctx, "POST", "/accounts", {
    name,
    type: "checking",
    openingBalance: { on: "2026-01-01", amount: opening },
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function expense(ctx: Ctx, accountId: string, amount: string, on: string): Promise<string> {
  const movement = await send(ctx, "POST", "/transactions/manual", {
    kind: "expense",
    amount,
    on,
    accountId,
    categoryId: null,
    payee: "Shop",
    note: "",
    key: crypto.randomUUID(),
  });
  expect(movement.status, JSON.stringify(movement.body)).toBe(201);
  return movement.body.id as string;
}

/**
 * A pocket on an account with two expenses, and a standalone one; an expense on another account. A
 * pocket with a monthly amount is given its start month on creation.
 */
async function seed(ctx: Ctx) {
  const savings = await account(ctx, "Savings", "5000");
  const checking = await account(ctx, "Checking", "800");
  await expense(ctx, savings, "120", "2026-10-05");
  await expense(ctx, savings, "30.50", "2026-10-07");
  const loose = await expense(ctx, checking, "84", "2026-10-12");
  const holiday = await send(ctx, "POST", "/pockets", {
    name: "Holiday",
    color: "#3366cc",
    accountId: savings,
    target: "1500",
    monthly: "100",
    startMonth: "2026-10-01",
  });
  expect(holiday.status, JSON.stringify(holiday.body)).toBe(201);
  const gifts = await send(ctx, "POST", "/pockets", {
    name: "Gifts",
    color: null,
    accountId: null,
    target: null,
    monthly: null,
    startMonth: "2026-10-01",
  });
  expect(gifts.status).toBe(201);
  return { savings, checking, loose, holiday: holiday.body.id as string, gifts: gifts.body.id as string };
}

describe("the routes of pockets", () => {
  it("creates, fills, plans, links and reads a pocket of the person's own only", async () => {
    const { savings, loose, holiday, gifts } = await seed(alice);
    expect(
      (await send(alice, "POST", `/pockets/${holiday}/deposits`, { amount: "500", on: "2026-10-01" })).status,
    ).toBe(204);
    expect(
      (
        await send(alice, "POST", `/pockets/${holiday}/planned`, {
          amount: "200",
          dueOn: "2099-12-01",
          description: "Hotel",
        })
      ).status,
    ).toBe(204);

    const candidates = await send(alice, "GET", "/pockets/candidates");
    expect(candidates.body.candidates.map((row: { id: string }) => row.id)).toEqual([loose]);
    expect((await send(alice, "PUT", `/pockets/${gifts}/expenses/${loose}`)).status).toBe(204);
    expect((await send(alice, "PUT", `/pockets/${gifts}/expenses/${loose}`)).body).toEqual({
      error: "conflict",
      reason: "already_linked",
    });

    const list = await send(alice, "GET", "/pockets");
    expect(list.status).toBe(200);
    expect(list.body.pockets).toEqual([
      {
        id: gifts,
        name: "Gifts",
        color: null,
        state: "active",
        accountId: null,
        account: null,
        startMonth: "2026-10-01",
        target: null,
        monthly: null,
        balance: "-84.00",
        percent: null,
        planned: { count: 0, total: "0.00", after: "-84.00" },
      },
      {
        id: holiday,
        name: "Holiday",
        color: "#3366cc",
        state: "active",
        accountId: savings,
        account: "Savings",
        startMonth: "2026-10-01",
        target: "1500.00",
        monthly: "100.00",
        balance: "449.50",
        percent: 30,
        planned: { count: 1, total: "200.00", after: "249.50" },
      },
    ]);
    expect(list.body.totals).toEqual({
      earmarked: "365.50",
      backing: "4849.50",
      free: "4400.00",
      monthly: "100.00",
    });
    expect(list.body.backingAccounts).toEqual([{ id: savings, name: "Savings", free: "4400.00" }]);

    const detail = await send(alice, "GET", `/pockets/${holiday}`);
    expect(detail.body.pocket).toEqual(
      expect.objectContaining({
        ...list.body.pockets[1],
        budget: "600.00",
        accrued: "100.00",
        spent: "-150.50",
        toGo: "1050.50",
        interest: null,
        interestReason: "no_interest_data",
        freeOnAccount: "4400.00",
      }),
    );
    expect(detail.body.history).toHaveLength(12);
    expect(detail.body.expenses.map((row: { amount: string }) => row.amount)).toEqual(["30.50", "120.00"]);
    const plannedId = detail.body.planned[0].id as string;

    // Nothing of Alice's is Bob's: not her pocket, not her planned expense.
    expect((await send(bob, "GET", `/pockets/${holiday}`)).status).toBe(404);
    expect((await send(bob, "DELETE", `/pockets/planned/${plannedId}`)).status).toBe(404);
    expect((await send(bob, "GET", "/pockets")).body.pockets).toEqual([]);
    expect((await send(alice, "GET", `/pockets/${holiday}`)).body.planned).toHaveLength(1);

    expect((await send(alice, "DELETE", `/pockets/planned/${plannedId}`)).status).toBe(204);
    expect((await send(alice, "DELETE", `/pockets/${gifts}/expenses/${loose}`)).status).toBe(204);
    expect((await send(alice, "PUT", `/pockets/${holiday}/state`, { state: "archived" })).status).toBe(204);
    expect((await send(alice, "GET", `/pockets/${holiday}`)).status).toBe(404);
    const after = await send(alice, "GET", "/pockets");
    expect(after.body.archived.map((row: { id: string }) => row.id)).toEqual([holiday]);
    expect(after.body.pockets[0].balance).toBe("0.00");
  });

  it("refuses what is not an amount, a pocket of the person or a state the pocket allows", async () => {
    const { holiday, gifts, savings } = await seed(alice);
    const deposit = (amount: string, on = "2026-10-01") =>
      send(alice, "POST", `/pockets/${holiday}/deposits`, { amount, on });
    expect((await deposit("1.234,5")).status).toBe(400);
    expect((await deposit("0")).body).toEqual({ error: "invalid", reason: "invalid" });
    expect((await deposit("1", "2099-01-01")).body).toEqual({ error: "invalid", reason: "future_date" });
    const body = { name: "Holiday", color: null, accountId: null, target: null, monthly: null };
    expect((await send(alice, "POST", "/pockets", { ...body, startMonth: "2026-10-01" })).body).toEqual({
      error: "conflict",
      reason: "duplicate_name",
    });
    expect(
      (await send(alice, "PUT", `/pockets/${gifts}`, { ...body, name: "X", startMonth: "2026-10-02" }))
        .status,
    ).toBe(400);
    expect(
      (await send(bob, "POST", "/pockets", { ...body, accountId: savings, startMonth: "2026-10-01" })).body,
    ).toEqual({ error: "invalid", reason: "invalid_account" });
    expect((await send(alice, "PUT", `/pockets/${holiday}/expenses/${crypto.randomUUID()}`)).body).toEqual({
      error: "conflict",
      reason: "backed",
    });
  });
});

describe("parity of pockets: action = route = MCP tool = export = Overview", () => {
  it("adds what the action added from the same typed text", async () => {
    const { holiday, gifts } = await seed(alice);
    // The action reads the text in the person's number format on the server; the route takes the decimal.
    await pockets.addToPocket(alice, holiday, {
      cents: parseAmount("1.234,5", alice.numberFormat),
      on: "2026-10-01",
    });
    await send(alice, "POST", `/pockets/${gifts}/deposits`, { amount: "1234.50", on: "2026-10-01" });
    const list = (await send(alice, "GET", "/pockets")).body;
    expect(list.pockets.map((row: { balance: string }) => row.balance)).toEqual(["1234.50", "1184.00"]);
  });

  it("answers list_pockets, the export, the page and Overview with the same balances", async () => {
    await seed(alice);
    const tool = reads.find((one) => one.name === "list_pockets")!;
    const route = (await send(alice, "GET", "/pockets")).body;
    expect(await tool.run(alice, {})).toEqual(route);
    // The page and the export read `pocketsView`; Overview reads `pocketBalances`: one balance.
    const view = await pockets.pocketsView(alice);
    const balances = await pockets.pocketBalances(alice);
    const cents = (row: { balance: string }) => BigInt(row.balance.replace(".", ""));
    expect(view.pockets.map((row) => row.balanceCents)).toEqual(route.pockets.map(cents));
    expect(balances.map((row) => row.balanceCents)).toEqual(route.pockets.map(cents));
    const overview = (await send(alice, "GET", "/pockets/overview")).body;
    expect(overview).toEqual({ total: route.totals.earmarked, monthly: route.totals.monthly, count: 2 });
    const tile = await pockets.pocketsTotal(alice);
    expect(tile).toEqual({ totalCents: view.earmarkedCents, monthlyCents: view.monthlyCents, count: 2 });
  });
});
