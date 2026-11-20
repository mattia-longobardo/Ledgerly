// The routes of budgets (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case through
// its route, the person's own data only, route = MCP tool = export, and a group's spent = the movements
// Expenses lists for the group (BUD-5). The guard is the test's: `api.itest.ts` proves the tokens.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { parseAmount } from "@ledgerly/format/format";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const budgets = await import("@ledgerly/domain/budgets");
const { createCategory } = await import("@ledgerly/domain/transactions");

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

const MONTH = "2026-10";

/** An account, a group with a sub-category and an unrelated category, and October's spending. */
async function seed(ctx: Ctx) {
  const created = await send(ctx, "POST", "/accounts", {
    name: "Cash",
    type: "cash",
    openingBalance: { on: "2026-01-01", amount: "1000" },
  });
  expect(created.status).toBe(201);
  const account = created.body.id as string;
  const group = (await createCategory(ctx, { name: "Home" })).id;
  const child = (await createCategory(ctx, { name: "Food", parentId: group })).id;
  const other = (await createCategory(ctx, { name: "Fun" })).id;
  for (const [categoryId, amount] of [
    [group, "100"],
    [child, "40.50"],
    [other, "7"],
    [null, "3"],
  ] as const) {
    const movement = await send(ctx, "POST", "/transactions/manual", {
      kind: "expense",
      amount,
      on: "2026-10-05",
      accountId: account,
      categoryId,
      payee: "Shop",
      note: "",
      key: crypto.randomUUID(),
    });
    expect(movement.status, JSON.stringify(movement.body)).toBe(201);
  }
  return { account, group, child, other };
}

describe("the routes of budgets", () => {
  it("sets, reads, alerts and stops a budget of the person's own only", async () => {
    const { account, group, child } = await seed(alice);
    const groupSlug = `${group}_all`;
    const childSlug = `${child}_${account}`;
    expect(
      (await send(alice, "PUT", `/budgets/${groupSlug}/limit`, { month: MONTH, amount: "300" })).status,
    ).toBe(204);
    expect(
      (await send(alice, "PUT", `/budgets/${childSlug}/limit`, { month: `${MONTH}-01`, amount: "40" }))
        .status,
    ).toBe(204);

    const list = await send(alice, "GET", `/budgets?month=${MONTH}`);
    expect(list.body).toEqual({
      month: "2026-10-01",
      budgets: [
        {
          categoryId: group,
          category: "Home",
          group: null,
          accountId: null,
          account: null,
          limit: "300.00",
          spent: "140.50",
          status: "on_track",
          percent: 47,
        },
        {
          categoryId: child,
          category: "Food",
          group: "Home",
          accountId: account,
          account: "Cash",
          limit: "40.00",
          spent: "40.50",
          status: "over",
          percent: 101,
        },
      ],
      totals: { limit: "300.00", spent: "140.50" },
      unbudgeted: "10.00",
    });

    const view = await send(alice, "GET", `/budgets/view?month=${MONTH}`);
    expect(view.status).toBe(200);
    // The page's row is the row of `list_budgets` and what the screen adds: one mapper.
    expect(view.body.budgets).toEqual(list.body.budgets.map((row: object) => expect.objectContaining(row)));
    expect(
      view.body.budgets.map((row: Record<string, unknown>) => [row.slug, row.name, row.depth, row.remaining]),
    ).toEqual([
      [groupSlug, "Home", 0, "159.50"],
      [childSlug, "Home › Food", 0, "-0.50"],
    ]);
    expect(view.body.totals).toEqual({ limit: "300.00", spent: "140.50", remaining: "159.50", percent: 47 });
    // The page's `percentOf(totals.spent, totals.limit)`, from the domain's own view.
    const month = await budgets.budgetsView(alice, "2026-10-01");
    expect(view.body.totals.percent).toBe(
      budgets.percentOf(month.totals.spentCents, month.totals.limitCents),
    );
    expect(view.body.toCategorise.amount).toMatch(/^\d+\.\d{2}$/);
    expect(view.body.firstMonth).toBe("2026-10-01");

    const overview = await send(alice, "GET", `/budgets/overview?month=${MONTH}`);
    expect(overview.body.budgets.map((row: { slug: string }) => row.slug)).toEqual([childSlug, groupSlug]);

    const detail = await send(alice, "GET", `/budgets/${childSlug}?month=${MONTH}`);
    expect(detail.body.budget).toEqual(view.body.budgets[1]);
    expect(detail.body.history).toHaveLength(6);
    expect(detail.body.history[0]).toEqual({
      month: "2026-09-01",
      limit: null,
      spent: "0.00",
      percent: null,
      remaining: null,
    });
    expect(detail.body.alerts).toEqual({ enabled: true, thresholds: [85, 100] });

    const alerts = await send(alice, "PUT", `/budgets/${childSlug}/alerts`, {
      enabled: true,
      thresholds: [100, 50, 50],
    });
    expect(alerts.body).toEqual({ enabled: true, thresholds: [50, 100] });
    expect((await send(alice, "GET", `/budgets/${childSlug}?month=${MONTH}`)).body.alerts).toEqual(
      alerts.body,
    );

    // Another person's category and account are not found; nothing of Alice's shows to Bob.
    expect(
      (await send(bob, "PUT", `/budgets/${childSlug}/limit`, { month: MONTH, amount: "1" })).status,
    ).toBe(404);
    expect((await send(bob, "GET", `/budgets?month=${MONTH}`)).body.budgets).toEqual([]);

    expect((await send(alice, "POST", `/budgets/${childSlug}/stop`, { month: MONTH })).status).toBe(204);
    expect((await send(alice, "GET", `/budgets/${childSlug}?month=${MONTH}`)).status).toBe(404);
  });

  it("answers each month of a budget's history with the page's percent and what is left", async () => {
    const { account, group } = await seed(alice);
    const slug = `${group}_all`;
    // September over its limit, August without one; October is the month asked for.
    await send(alice, "PUT", `/budgets/${slug}/limit`, { month: "2026-09", amount: "100" });
    const spent = await send(alice, "POST", "/transactions/manual", {
      kind: "expense",
      amount: "150",
      on: "2026-09-10",
      accountId: account,
      categoryId: group,
      payee: "Shop",
      note: "",
      key: crypto.randomUUID(),
    });
    expect(spent.status).toBe(201);
    const history = (await send(alice, "GET", `/budgets/${slug}?month=${MONTH}`)).body.history;
    expect(history.slice(0, 2)).toEqual([
      { month: "2026-09-01", limit: "100.00", spent: "150.00", percent: 150, remaining: "-50.00" },
      { month: "2026-08-01", limit: null, spent: "0.00", percent: null, remaining: null },
    ]);
    const detail = await budgets.budgetDetail(alice, { categoryId: group, accountId: null }, "2026-10-01");
    expect(history.map((row: { percent: number | null }) => row.percent)).toEqual(
      detail!.history.map((past) =>
        past.limitCents === null ? null : budgets.percentOf(past.spentCents, past.limitCents),
      ),
    );
  });

  it("refuses what is not an amount, a month or a budget", async () => {
    const { group } = await seed(alice);
    const limit = (slug: string, body: unknown) => send(alice, "PUT", `/budgets/${slug}/limit`, body);
    expect((await limit(`${group}_all`, { month: MONTH, amount: "1.234,5" })).status).toBe(400);
    expect((await limit(`${group}_all`, { month: MONTH, amount: "0" })).status).toBe(400);
    expect((await limit(`${group}_all`, { month: "2026-13", amount: "1" })).status).toBe(400);
    expect((await limit("all_all", { month: MONTH, amount: "1" })).status).toBe(400);
    expect((await send(alice, "GET", "/budgets?month=2026-10-02")).status).toBe(400);
    const alertsOn = await send(alice, "PUT", `/budgets/${group}_all/alerts`, {
      enabled: true,
      thresholds: [],
    });
    expect(alertsOn.status).toBe(400);
  });
});

describe("parity of budgets: action = route = MCP tool = export", () => {
  it("writes the limit the action wrote from the same typed text", async () => {
    const { group, other } = await seed(alice);
    // The action reads the text in the person's number format on the server; the route takes the decimal.
    await budgets.setLimit(alice, {
      categoryId: group,
      accountId: null,
      month: "2026-10-01",
      cents: parseAmount("1.234,5", alice.numberFormat),
    });
    await send(alice, "PUT", `/budgets/${other}_all/limit`, { month: MONTH, amount: "1234.50" });
    const limits = (await send(alice, "GET", `/budgets?month=${MONTH}`)).body.budgets.map(
      (row: { limit: string }) => row.limit,
    );
    expect(limits).toEqual(["1234.50", "1234.50"]);
  });

  it("answers list_budgets with what GET /budgets answers, and the export's numbers", async () => {
    const { group } = await seed(alice);
    await send(alice, "PUT", `/budgets/${group}_all/limit`, { month: MONTH, amount: "300" });
    const tool = reads.find((one) => one.name === "list_budgets")!;
    const route = (await send(alice, "GET", `/budgets?month=${MONTH}`)).body;
    expect(await tool.run(alice, { month: MONTH })).toEqual(route);
    // The export writes the rows of the same view (`platform/export/service.ts`).
    const view = await budgets.budgetsView(alice, "2026-10-01");
    expect(view.rows.map((row) => [row.name, row.status, String(row.spentCents)])).toEqual(
      route.budgets.map((row: { category: string; status: string; spent: string }) => [
        row.category,
        row.status,
        row.spent.replace(".", ""),
      ]),
    );
  });

  it("counts in a group's spent the movements Expenses lists for the group (BUD-5)", async () => {
    const { group } = await seed(alice);
    await send(alice, "PUT", `/budgets/${group}_all/limit`, { month: MONTH, amount: "300" });
    const listed = await send(
      alice,
      "GET",
      `/transactions?category=${group}&type=expense&from=2026-10-01&to=2026-10-31`,
    );
    const cents = listed.body.transactions.reduce(
      (sum: bigint, row: { amount: string }) => sum - BigInt(row.amount.replace(".", "")),
      0n,
    );
    const spent = (await send(alice, "GET", `/budgets?month=${MONTH}`)).body.budgets[0].spent as string;
    expect(BigInt(spent.replace(".", ""))).toBe(cents);
  });
});
