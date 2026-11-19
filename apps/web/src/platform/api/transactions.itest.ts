// The routes of transactions (rewrite plan R2, 05-refactor.md §5.5): each Server Action's use case
// through its route, the person's own data only, and route = MCP tool. The guard is the test's:
// `api.itest.ts` proves the tokens and the scopes of `/api/v1`.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { reads, adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");

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

const as = (ctx: Ctx) =>
  apiRoutes({
    ...adapters,
    guard: () => async (context, next) => {
      context.set("ctx", ctx);
      await next();
    },
  });

async function send(ctx: Ctx, method: string, path: string, body?: unknown) {
  const response = await as(ctx).request(path, {
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

const KEY = "0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e";

async function newAccount(ctx: Ctx, name = "Cash") {
  const created = await send(ctx, "POST", "/accounts", {
    name,
    type: "cash",
    openingBalance: { on: "2026-01-01", amount: "100" },
  });
  expect(created.status).toBe(201);
  return created.body.id as string;
}

async function manual(ctx: Ctx, accountId: string, body: Record<string, unknown> = {}, key?: string) {
  const created = await send(ctx, "POST", "/transactions/manual", {
    kind: "expense",
    amount: "12.5",
    on: "2026-02-10",
    accountId,
    categoryId: null,
    payee: "Corner shop",
    note: "",
    key: key ?? crypto.randomUUID(),
    ...body,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body as { id: string; created: boolean };
}

const balanceOf = async (ctx: Ctx, accountId: string) =>
  (await send(ctx, "GET", "/accounts")).body.accounts.find((one: { id: string }) => one.id === accountId)
    .balance as string;

describe("the manual movement", () => {
  it("writes once per key, changes, previews and deletes a movement, with the balance kept right", async () => {
    const account = await newAccount(alice);
    const form = await send(alice, "GET", "/transactions/manual/form");
    expect(form.body.accounts).toEqual([
      expect.objectContaining({ id: account, mode: "manual", source: null }),
    ]);
    const preview = await send(alice, "POST", "/transactions/manual/preview", {
      kind: "expense",
      amount: "12.5",
      on: "2026-02-10",
      accountId: account,
    });
    expect(preview.body.preview).toMatchObject({ kind: "change", before: "100.00", after: "87.50" });

    const first = await manual(alice, account, {}, KEY);
    const again = await manual(alice, account, {}, KEY);
    expect(again).toEqual({ ...first, created: false });
    expect(await balanceOf(alice, account)).toBe("87.50");

    const changed = await send(alice, "PUT", `/transactions/manual/${first.id}`, {
      kind: "income",
      amount: "20",
      on: "2026-02-11",
      accountId: account,
      categoryId: null,
      payee: "Refund",
      note: "",
    });
    expect(changed.body).toEqual({ id: first.id, created: false, on: "2026-02-11", accountId: account });
    expect(await balanceOf(alice, account)).toBe("120.00");
    expect((await send(bob, "DELETE", `/transactions/manual/${first.id}`)).status).toBe(404);
    expect((await send(alice, "DELETE", `/transactions/manual/${first.id}`)).status).toBe(204);
    expect(await balanceOf(alice, account)).toBe("100.00");
  });

  it("refuses an amount that is not one and a day after today", async () => {
    const account = await newAccount(alice);
    const zero = await send(alice, "POST", "/transactions/manual", {
      kind: "expense",
      amount: "0",
      on: "2026-02-10",
      accountId: account,
      categoryId: null,
      payee: "",
      note: "",
      key: KEY,
    });
    expect(zero).toEqual({ status: 400, body: { error: "invalid", reason: "amount" } });
    const later = await send(alice, "POST", "/transactions/manual", {
      kind: "expense",
      amount: "1",
      on: "2999-01-01",
      accountId: account,
      categoryId: null,
      payee: "",
      note: "",
      key: KEY,
    });
    expect(later).toEqual({ status: 400, body: { error: "invalid", reason: "future_date" } });
  });
});

describe("the movements", () => {
  it("lists, reads, notes, files and hides a movement of the person's own only", async () => {
    const account = await newAccount(alice);
    const { id } = await manual(alice, account);
    const category = (
      await send(alice, "POST", "/categories", { name: "Food", type: "expense", parentId: null, color: null })
    ).body.id;
    const label = (await send(alice, "POST", "/labels", { name: "Home", color: null })).body.id;

    expect(
      (await send(alice, "PATCH", `/transactions/${id}`, { note: "  milk ", labelIds: [label] })).status,
    ).toBe(204);
    expect(
      (await send(alice, "PUT", "/transactions/category", { ids: [id], categoryId: category })).body,
    ).toEqual({ count: 1 });
    const one = await send(alice, "GET", `/transactions/${id}`);
    expect(one.body).toMatchObject({
      id,
      note: "milk",
      labels: ["Home"],
      labelIds: [label],
      categoryId: category,
      origin: "manual",
      editableAtSource: false,
    });
    expect((await send(bob, "GET", `/transactions/${id}`)).status).toBe(404);
    expect((await send(bob, "PUT", "/transactions/category", { ids: [id], categoryId: null })).body).toEqual({
      count: 0,
    });

    const list = await send(alice, "GET", "/transactions?from=2026-02-01&to=2026-02-28");
    expect(list.body.summary).toEqual({ count: 1, income: "0.00", expense: "-12.50", net: "-12.50" });
    const view = await send(alice, "GET", "/transactions/view?from=2026-02-01&to=2026-02-28");
    expect(view.body.rows[0]).toEqual(one.body);
    expect(view.body.months).toEqual([{ month: "2026-02-01", count: 1, net: "-12.50" }]);
    expect((await send(alice, "GET", "/payees?q=corner")).body).toEqual({
      payees: [{ payee: "Corner shop", count: 1 }],
    });
    const spending = await send(alice, "GET", "/transactions/spending?groupBy=category");
    expect(spending.body.groups).toEqual([
      expect.objectContaining({ categoryId: category, amount: "-12.50", share: 100, in: null }),
    ]);
  });

  it("keeps each visibility action's effect on a manual account's balance (rebuildBalances)", async () => {
    const kept = await newAccount(alice, "Kept");
    const rebuilt = await newAccount(alice, "Rebuilt");
    const a = await manual(alice, kept);
    const b = await manual(alice, rebuilt);
    // The actions of the other pages leave the balance as it is, as `hideTransactions` does today.
    const before = await balanceOf(alice, kept);
    for (const change of ["hide", "restore", "hide", "delete"]) {
      const done = await send(alice, "POST", "/transactions/visibility", {
        ids: [a.id],
        change,
        rebuildBalances: false,
      });
      expect(done.body).toEqual({ count: 1 });
      expect(await balanceOf(alice, kept), change).toBe(before);
    }
    // Expenses rebuilds it, as `changeVisibility` does today.
    const hidden = await send(alice, "POST", "/transactions/visibility", {
      ids: [b.id],
      change: "hide",
      rebuildBalances: true,
    });
    expect(hidden.body).toEqual({ count: 1 });
    expect(await balanceOf(alice, rebuilt)).toBe("100.00");
  });
});

describe("the rules", () => {
  it("saves, previews, applies and undoes a rule, with its amounts as decimals", async () => {
    const account = await newAccount(alice);
    await manual(alice, account);
    const category = (
      await send(alice, "POST", "/categories", { name: "Food", type: "expense", parentId: null, color: null })
    ).body.id;
    const rule = {
      name: "Shop",
      conditions: [
        { field: "text", op: "contains", value: "corner" },
        { field: "amount", op: "lt", amount: "50" },
      ],
      categoryId: category,
    };
    const preview = await send(alice, "POST", "/rules/preview", { rule, ruleId: null });
    expect(preview.body).toMatchObject({ matched: 1, changes: 1, retyped: null });
    const created = await send(alice, "POST", "/rules", rule);
    expect(created).toMatchObject({ status: 201, body: { changes: 1 } });
    const listed = await send(alice, "GET", "/rules");
    expect(listed.body.rules[0].conditions[1]).toEqual({ field: "amount", op: "lt", amount: "50.00" });
    expect((await send(alice, "PUT", `/rules/${created.body.id}/active`, { active: false })).status).toBe(
      204,
    );
    expect((await send(alice, "PUT", "/rules/order", { ids: [created.body.id] })).status).toBe(204);
    const applied = await send(alice, "POST", `/rules/${created.body.id}/apply`);
    expect(applied.body.count).toBe(1);
    expect((await send(alice, "POST", `/rules/apply/undo/${applied.body.undoId}`)).status).toBe(204);
    expect((await send(bob, "DELETE", `/rules/${created.body.id}`)).status).toBe(404);
    expect((await send(alice, "DELETE", `/rules/${created.body.id}`)).status).toBe(204);
    expect((await send(alice, "POST", `/rules/${created.body.id}/restore`)).status).toBe(204);
    expect((await send(alice, "GET", `/rules/draft?category=${category}`)).body.draft).toMatchObject({
      categoryId: category,
    });
  });
});

describe("the review and the search", () => {
  it("answers the review of a person with no source, and the palette's records", async () => {
    expect((await send(alice, "GET", "/transactions/review")).body).toEqual({
      accountIds: [],
      preparing: false,
      suggested: [],
      unsuggested: [],
      singles: [],
      mergeProposals: [],
    });
    expect((await send(alice, "GET", "/search?q=x")).body).toEqual({ records: [] });
  });
});

describe("parity of transactions: route = MCP tool", () => {
  it("answers each read tool of transactions with what its route answers", async () => {
    const account = await newAccount(alice);
    await manual(alice, account);
    const tool = (name: string) => reads.find((one) => one.name === name)!;
    // The tool keeps the arguments and the page size of F8: `account_id`, 50 rows.
    expect(await tool("list_transactions").run(alice, { account_id: account })).toEqual(
      (await send(alice, "GET", `/transactions?account=${account}&limit=50`)).body,
    );
    expect(await tool("get_spending").run(alice, { groupBy: "month" })).toEqual(
      (await send(alice, "GET", "/transactions/spending?groupBy=month")).body,
    );
  });
});
