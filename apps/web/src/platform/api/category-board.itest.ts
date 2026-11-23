// `GET /categories/board` (client R3): the board of Expenses › Categories answers what the page
// joined on the server from the same domain functions — `macroViews`, `colorOfCategory`, the budget of
// the period's last month and the source note — for a group with movements of its own and of a child,
// movements without a category, a category with a budget and one with a source.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const domain = await import("@ledgerly/domain/transactions");
const { budgetsView, setLimit } = await import("@ledgerly/domain/budgets");
const { centsToDecimal } = await import("@ledgerly/domain/shared/money");
const { sourceNameOf } = await import("@/platform/integrations/registry");

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

const FROM = "2026-02-01";
const TO = "2026-02-28";

/** A source account whose «Tobacco» counts under its «Alcohol, tobacco»: a note on that category. */
async function sourceWithNote(ctx: Ctx): Promise<string> {
  const { applyProviderAccounts } = await import("@domain/modules/accounts/service");
  const { listAccounts } = await import("@domain/modules/accounts/queries");
  const { upsertFromProvider } = await import("@domain/modules/transactions/service");
  await applyProviderAccounts(ctx, "plugin:wallet", [
    {
      provider: "plugin:wallet",
      providerAccountId: "acc-1",
      name: "Current",
      type: "checking",
      currency: "EUR",
    },
  ]);
  const account = (await listAccounts(ctx)).find((one) => one.name === "Current")!;
  const incoming = (externalId: string, name: string) => ({
    externalId,
    counterpartExternalId: null,
    occurredAt: new Date("2026-02-10T10:00:00Z"),
    amountCents: -1_000n,
    currency: "EUR",
    type: "expense" as const,
    state: "cleared" as const,
    payee: externalId,
    note: null,
    categoryExternalId: name,
    categoryName: name,
    categoryGroupExternalId: null,
    categoryGroupName: null,
    labels: [],
  });
  await upsertFromProvider(
    ctx,
    account.id,
    [incoming("e-1", "Tobacco"), incoming("e-2", "Alcohol, tobacco")],
    { provider: "plugin:wallet" },
  );
  const alcohol = (await domain.listCategories(ctx)).find((one) => one.name === "Alcohol, tobacco")!;
  const tobacco = (await send(ctx, "GET", "/source-categories")).body.sourceCategories.find(
    (one: { name: string }) => one.name === "Tobacco",
  );
  // «Categories of {source}»: the source's name and its page come with each row.
  expect(tobacco).toMatchObject({ sourceName: await sourceNameOf("plugin:wallet", "en"), source: "wallet" });
  expect(
    (await send(ctx, "PUT", `/source-categories/${tobacco.id}`, { categoryId: alcohol.id })).status,
  ).toBe(200);
  return alcohol.id;
}

/** A cash account, House with Rent under it, February's movements and a limit on House. */
async function seed(ctx: Ctx) {
  const created = await send(ctx, "POST", "/accounts", {
    name: "Cash",
    type: "cash",
    openingBalance: { on: "2026-01-01", amount: "1000" },
  });
  const cash = created.body.id as string;
  const category = async (name: string, parentId: string | null) =>
    (await send(ctx, "POST", "/categories", { name, type: "expense", parentId, color: null })).body
      .id as string;
  const house = await category("House", null);
  const rent = await category("Rent", house);
  for (const [categoryId, amount] of [
    [rent, "500"],
    [house, "100"],
    [null, "3"],
  ] as const) {
    const movement = await send(ctx, "POST", "/transactions/manual", {
      kind: "expense",
      amount,
      on: "2026-02-05",
      accountId: cash,
      categoryId,
      payee: "Shop",
      note: "",
      key: crypto.randomUUID(),
    });
    expect(movement.status, JSON.stringify(movement.body)).toBe(201);
  }
  await setLimit(ctx, { categoryId: house, accountId: null, month: "2026-02-01", cents: 50_000n });
  const alcohol = await sourceWithNote(ctx);
  return { cash, house, rent, alcohol };
}

/** The board as the page built it on the server, from the same functions, on the wire. */
async function pageBoard(ctx: Ctx, accountIds?: string[]) {
  const { sourceNotes } = await import("@/app/(app)/settings/finance/source");
  const all = await domain.listCategoriesWithUsage(ctx, { includeArchived: true });
  const totals = await domain.categoryMacroTotals(ctx, { from: FROM, to: TO, accountIds });
  const budgets = await budgetsView(ctx, "2026-02-01");
  const notes = await sourceNotes(ctx);
  const byId = new Map(all.map(({ category }) => [category.id, category]));
  const views = domain.macroViews(
    all.map(({ category }) => ({
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      type: category.type,
      archived: category.archivedAt !== null,
    })),
    totals,
  );
  type Sum = { count: number; totalCents: bigint; inCents: bigint; outCents: bigint };
  const amount = (sum: Sum) => ({
    count: sum.count,
    total: centsToDecimal(sum.totalCents),
    in: centsToDecimal(sum.inCents),
    out: centsToDecimal(-sum.outCents),
  });
  type Line = (typeof views)[number]["groups"][number]["children"][number];
  const line = (one: Line) => {
    const category = byId.get(one.category.id)!;
    const budget = budgets.rows.find((row) => row.accountId === null && row.categoryId === category.id);
    const note = notes.get(category.id);
    return {
      id: category.id,
      name: category.name,
      parentId: category.parentId,
      type: category.type,
      color: domain.colorOfCategory(category, byId),
      chosenColor: category.color,
      archived: one.category.archived,
      canMerge: category.providerName === null,
      usage: all.find((row) => row.category.id === category.id)!.usage,
      ...amount(one),
      share: one.share,
      budget: budget ? { limit: centsToDecimal(budget.limitCents), status: budget.status } : null,
      source:
        note && note.names.length > 0
          ? { provider: note.provider, name: note.source, names: note.names }
          : null,
    };
  };
  return {
    macros: views.map((view) => ({
      macro: view.macro,
      ...amount(view),
      groups: view.groups.map((group) => ({
        ...line(group),
        only: group.only && { total: centsToDecimal(group.only.totalCents), count: group.only.count },
        children: group.children.map(line),
      })),
      rest: view.rest && amount(view.rest),
    })),
  };
}

describe("the board of the categories (client R3)", () => {
  it("answers what the page joined: own share and children, the rest, a budget and a source", async () => {
    const { house, rent, alcohol } = await seed(alice);
    const board = (await send(alice, "GET", `/categories/board?from=${FROM}&to=${TO}`)).body;
    expect(board).toEqual(await pageBoard(alice));

    const expense = board.macros.find((one: { macro: string }) => one.macro === "expense");
    expect([expense.count, expense.total, expense.in, expense.out]).toEqual([5, "-623.00", "0.00", "623.00"]);
    const [first, second] = expense.groups;
    expect(first).toMatchObject({
      id: house,
      total: "-600.00",
      count: 2,
      out: "600.00",
      only: { total: "-100.00", count: 1 },
      budget: { limit: "500.00", status: "over" },
      source: null,
      canMerge: true,
      chosenColor: null,
    });
    expect(first.children).toEqual([
      expect.objectContaining({ id: rent, total: "-500.00", parentId: house }),
    ]);
    expect(first.children[0].color).toBe(first.color);
    expect(second).toMatchObject({ id: alcohol, total: "-20.00", canMerge: false, budget: null });
    expect(second.source).toMatchObject({
      provider: "plugin:wallet",
      names: ["Alcohol, tobacco", "Tobacco"],
    });
    expect(expense.rest).toEqual({ count: 1, total: "-3.00", in: "0.00", out: "3.00" });
    expect(board.macros.map((one: { macro: string }) => one.macro)).toEqual([
      "income",
      "expense",
      "transfer",
    ]);
  });

  it("draws each category of GET /categories in the colour of the domain's rule (displayColor)", async () => {
    const { house, rent } = await seed(alice);
    const listed = (await send(alice, "GET", "/categories?archived=true")).body.categories;
    const all = await domain.listCategoriesWithUsage(alice, { includeArchived: true });
    const byId = new Map(all.map(({ category }) => [category.id, category]));
    expect(listed.map((one: { id: string; displayColor: string }) => [one.id, one.displayColor])).toEqual(
      all.map(({ category }) => [category.id, domain.colorOfCategory(category, byId)]),
    );
    const colour = (id: string) => listed.find((one: { id: string }) => one.id === id).displayColor;
    expect(colour(rent)).toBe(colour(house));
  });

  it("counts the chosen accounts only, and nothing of another person", async () => {
    const { cash, house } = await seed(alice);
    const board = (await send(alice, "GET", `/categories/board?from=${FROM}&to=${TO}&accounts=${cash}`)).body;
    expect(board).toEqual(await pageBoard(alice, [cash]));
    expect(board.macros[1].total).toBe("-603.00");

    const other = await send(bob, "GET", `/categories/board?from=${FROM}&to=${TO}`);
    expect(other.status).toBe(200);
    expect(JSON.stringify(other.body)).not.toContain(house);
    expect((await send(alice, "GET", "/categories/board?from=2026-02-30&to=2026-02-28")).status).toBe(400);
  });
});
