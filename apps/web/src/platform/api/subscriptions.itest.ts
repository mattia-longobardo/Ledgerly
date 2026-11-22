// The routes of subscriptions (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case
// through its route, the person's own data only, and action = route = MCP tool = export. The guard is
// the test's: `api.itest.ts` proves the tokens.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { today } from "@domain/shared/dates";
import { centsToDecimal } from "@domain/shared/money";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const subscriptions = await import("@ledgerly/domain/subscriptions");

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
let todayOn: string;

beforeEach(async () => {
  await resetDatabase();
  alice = contextFor((await createTestUser()).id);
  bob = contextFor((await createTestUser()).id);
  todayOn = today(alice.timeZone);
});

afterAll(closeDatabase);

const body = (overrides: Record<string, unknown> = {}) => ({
  name: "Streaming",
  categoryId: null,
  accountId: null,
  price: "12.99",
  cycle: "yearly",
  chargeOn: todayOn,
  payeeMatch: "streaming",
  tolerance: "5",
  utility: 7,
  ...overrides,
});

/** An account with a balance and a charge of the streaming service paid today. */
async function seed(ctx: Ctx) {
  const created = await send(ctx, "POST", "/accounts", {
    name: "Checking",
    type: "checking",
    openingBalance: { on: "2026-01-01", amount: "900" },
  });
  expect(created.status).toBe(201);
  const accountId = created.body.id as string;
  const paid = await send(ctx, "POST", "/transactions/manual", {
    kind: "expense",
    amount: "12.99",
    on: todayOn,
    accountId,
    categoryId: null,
    payee: "Streaming Ltd",
    note: "",
    key: crypto.randomUUID(),
  });
  expect(paid.status, JSON.stringify(paid.body)).toBe(201);
  const streaming = await send(ctx, "POST", "/subscriptions", body({ accountId }));
  expect(streaming.status, JSON.stringify(streaming.body)).toBe(201);
  const gym = await send(ctx, "POST", "/subscriptions", body({ name: "Gym", payeeMatch: null, utility: 3 }));
  expect(gym.status).toBe(201);
  return { accountId, streaming: streaming.body.id as string, gym: gym.body.id as string };
}

describe("the routes of subscriptions", () => {
  it("creates, checks, changes and reads a subscription of the person's own only", async () => {
    const { accountId, streaming, gym } = await seed(alice);
    const list = await send(alice, "GET", "/subscriptions");
    expect(list.status).toBe(200);
    expect(list.body.subscriptions.map((row: { name: string }) => row.name)).toEqual(["Gym", "Streaming"]);
    expect(list.body.subscriptions[1]).toMatchObject({
      id: streaming,
      state: "active",
      accountId,
      account: "Checking",
      price: "12.99",
      cycle: "yearly",
      chargeOn: todayOn,
      utility: 7,
      payeeMatch: "streaming",
      tolerance: "5.00",
      monthly: "1.08",
      yearly: "12.99",
      current: { dueOn: todayOn, state: "paid", expected: "12.99", actual: "12.99" },
      lastMatch: { on: todayOn, amount: "12.99" },
    });
    expect(list.body.totals).toEqual({
      monthly: "2.16",
      yearly: "25.98",
      lowUtility: { yearly: "12.99", count: 1 },
      next30: { amount: "12.99", until: expect.any(String) },
    });
    expect(list.body.projections.month[0]).toMatchObject({
      accountId,
      balance: "887.01",
      commit: "0.00",
      projected: "887.01",
      percent: 0,
    });

    // Nothing of Alice's is Bob's.
    expect((await send(bob, "GET", "/subscriptions")).body.subscriptions).toEqual([]);
    expect((await send(bob, "PUT", `/subscriptions/${gym}`, body())).status).toBe(404);
    expect((await send(bob, "DELETE", `/subscriptions/${gym}`)).status).toBe(404);

    expect(
      (await send(alice, "PUT", `/subscriptions/${gym}`, body({ name: "Gym", tolerance: "2.5" }))).status,
    ).toBe(204);
    expect((await send(alice, "PUT", `/subscriptions/${gym}/state`, { state: "cancelled" })).status).toBe(
      204,
    );
    const after = (await send(alice, "GET", "/subscriptions")).body;
    expect(after.inactive).toMatchObject([{ id: gym, state: "cancelled", tolerance: "2.50" }]);
    expect((await send(alice, "DELETE", `/subscriptions/${gym}`)).status).toBe(204);
    expect((await send(alice, "GET", "/subscriptions")).body.inactive).toEqual([]);
  });

  it("refuses what is not a price, a tolerance, a reference of the person or a deletable one", async () => {
    const { accountId, streaming } = await seed(alice);
    expect((await send(alice, "POST", "/subscriptions", body({ price: "1.234,5" }))).status).toBe(400);
    expect((await send(alice, "POST", "/subscriptions", body({ price: "0" }))).body).toEqual({
      error: "invalid",
      reason: "invalid",
    });
    expect((await send(alice, "POST", "/subscriptions", body({ tolerance: "101" }))).status).toBe(400);
    expect((await send(bob, "POST", "/subscriptions", body({ accountId }))).body).toEqual({
      error: "invalid",
      reason: "invalid_account",
    });
    expect((await send(alice, "DELETE", `/subscriptions/${streaming}`)).body).toEqual({
      error: "conflict",
      reason: "not_cancelled",
    });
  });
});

describe("parity of subscriptions: action = route = MCP tool = export", () => {
  it("stores the tolerance the action stored from the same typed text", async () => {
    // The action reads the text in the person's number format on the server; the route takes the decimal.
    const typed = centsToDecimal(parseAmount("2,5", alice.numberFormat));
    const byAction = await subscriptions.createSubscription(alice, {
      name: "By action",
      priceCents: parseAmount("12,99", alice.numberFormat),
      cycle: "monthly",
      nextChargeOn: todayOn,
      tolerance: subscriptions.toleranceOf(typed),
    });
    await send(
      alice,
      "POST",
      "/subscriptions",
      body({ name: "By route", cycle: "monthly", tolerance: "2.5" }),
    );
    const rows = (await send(alice, "GET", "/subscriptions")).body.subscriptions;
    expect(rows.map((row: { id: string }) => row.id)).toContain(byAction.id);
    expect(rows.map((row: { tolerance: string; price: string }) => [row.tolerance, row.price])).toEqual([
      ["2.50", "12.99"],
      ["2.50", "12.99"],
    ]);
  });

  it("answers list_subscriptions, the export and the page with the same numbers", async () => {
    await seed(alice);
    const tool = reads.find((one) => one.name === "list_subscriptions")!;
    const route = (await send(alice, "GET", "/subscriptions")).body;
    expect(await tool.run(alice, {})).toEqual(route);
    // The page and the export read `subscriptionsView`.
    const view = await subscriptions.subscriptionsView(alice);
    expect(view.rows.map((row) => centsToDecimal(row.monthlyCents))).toEqual(
      route.subscriptions.map((row: { monthly: string }) => row.monthly),
    );
    expect(centsToDecimal(view.next30Cents)).toBe(route.totals.next30.amount);
    expect(view.projections.year.map((one) => centsToDecimal(one.commitCents))).toEqual(
      route.projections.year.map((one: { commit: string }) => one.commit),
    );
  });
});

describe("every N weeks or months, the optional vote and the list of an account (R5a)", () => {
  it("answers `custom` with its «every», keeps it on a change that leaves it out, and takes no vote", async () => {
    const account = await send(alice, "POST", "/accounts", {
      name: "Checking",
      type: "checking",
      openingBalance: { on: "2026-01-01", amount: "900" },
    });
    const created = await send(alice, "POST", "/subscriptions", {
      ...body({ accountId: account.body.id, noVote: true }),
      cycle: "monthly",
      every: { unit: "month", count: 2 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const rowOf = async () =>
      (await send(alice, "GET", "/subscriptions")).body.subscriptions.find(
        (row: { id: string }) => row.id === created.body.id,
      );
    expect(await rowOf()).toMatchObject({
      cycle: "custom",
      every: { unit: "month", count: 2 },
      utility: 5,
      noVote: true,
    });
    expect((await rowOf()).yearly).toBe("77.94");

    // The dialog of today sends the nearest cycle and no «every»: the frequency stays.
    const changed = await send(alice, "PUT", `/subscriptions/${created.body.id}`, {
      ...body({ accountId: account.body.id, name: "Streaming 2", utility: 4 }),
      cycle: "monthly",
    });
    expect(changed.status, JSON.stringify(changed.body)).toBe(204);
    expect(await rowOf()).toMatchObject({ name: "Streaming 2", cycle: "custom", utility: 4 });
    expect((await rowOf()).noVote).toBeUndefined();

    // A cycle of the list given as «every» is that cycle, with no «every» on the wire.
    await send(alice, "PUT", `/subscriptions/${created.body.id}`, {
      ...body({ accountId: account.body.id }),
      every: { unit: "month", count: 12 },
    });
    const yearly = await rowOf();
    expect(yearly.cycle).toBe("yearly");
    expect(yearly.every).toBeUndefined();

    expect(
      (await send(alice, "POST", "/subscriptions", { ...body(), every: { unit: "week", count: 13 } })).status,
    ).toBe(400);
  });

  it("lists only what one account pays with `account`, the totals as for every subscription", async () => {
    const account = await send(alice, "POST", "/accounts", {
      name: "Card",
      type: "checking",
      openingBalance: { on: "2026-01-01", amount: "100" },
    });
    await send(alice, "POST", "/subscriptions", body({ name: "On the card", accountId: account.body.id }));
    await send(alice, "POST", "/subscriptions", body({ name: "Anywhere", accountId: null }));
    const all = await send(alice, "GET", "/subscriptions");
    const one = await send(alice, "GET", `/subscriptions?account=${account.body.id}`);
    expect(all.body.subscriptions.map((row: { name: string }) => row.name).sort()).toEqual([
      "Anywhere",
      "On the card",
    ]);
    expect(one.body.subscriptions.map((row: { name: string }) => row.name)).toEqual(["On the card"]);
    expect(one.body.totals).toEqual(all.body.totals);
  });
});
