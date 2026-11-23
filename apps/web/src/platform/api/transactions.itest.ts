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
    expect(list.body.summary).toEqual({
      count: 1,
      income: "0.00",
      expense: "-12.50",
      net: "-12.50",
      incomeLessExpense: "-12.50",
    });
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

  it("rebuilds a manual account's balance on every visibility action, whatever rebuildBalances says", async () => {
    // Every page now does what Expenses did: a hidden manual movement is out of the balance.
    for (const rebuildBalances of [false, true]) {
      const account = await newAccount(alice, `Manual ${rebuildBalances}`);
      const one = await manual(alice, account);
      const counted = await balanceOf(alice, account);
      for (const [change, expected] of [
        ["hide", "100.00"],
        ["restore", counted],
        ["hide", "100.00"],
        ["delete", "100.00"],
      ]) {
        const done = await send(alice, "POST", "/transactions/visibility", {
          ids: [one.id],
          change,
          rebuildBalances,
        });
        expect(done.body).toEqual({ count: 1 });
        expect(await balanceOf(alice, account), `${change}, rebuildBalances ${rebuildBalances}`).toBe(
          expected,
        );
      }
    }
  });
});

describe("the money of a range (decision D3)", () => {
  it("keeps net as every movement and adds income less spending beside it", async () => {
    const account = await newAccount(alice);
    await manual(alice, account, { kind: "income", amount: "100" });
    await manual(alice, account, { kind: "expense", amount: "30.25" });
    const { summary } = (await send(alice, "GET", "/transactions?from=2026-02-01&to=2026-02-28")).body;
    expect(summary).toMatchObject({ income: "100.00", expense: "-30.25", net: "69.75" });
    // With no giroconto the two agree; `net` keeps a giroconto's leg, `incomeLessExpense` never does.
    expect(summary.incomeLessExpense).toBe("69.75");
  });
});

describe("a total with a movement in another currency and no rate (decision D4)", () => {
  it("says how many movements it left out, in the answers and in the MCP tool", async () => {
    const created = await send(alice, "POST", "/accounts", {
      name: "Dollars",
      type: "cash",
      currency: "USD",
      openingBalance: { on: "2026-01-01", amount: "100" },
    });
    expect(created.status).toBe(201);
    // No rate is stored in the test database: the movement cannot be converted into EUR.
    await manual(alice, created.body.id, { on: "2026-03-10" });
    const range = "from=2026-03-01&to=2026-03-31";
    expect((await send(alice, "GET", `/transactions?${range}`)).body.summary).toMatchObject({
      count: 1,
      net: "0.00",
      excludedCount: 1,
    });
    const view = (await send(alice, "GET", `/transactions/view?${range}`)).body;
    expect(view.summary.excludedCount).toBe(1);
    expect(view.months).toEqual([{ month: "2026-03-01", count: 1, net: "0.00", excludedCount: 1 }]);
    const spending = (await send(alice, "GET", `/transactions/spending?${range}&groupBy=category`)).body;
    expect(spending.groups.map((group: { excludedCount?: number }) => group.excludedCount)).toEqual([1]);
    const tool = reads.find((one) => one.name === "list_transactions")!;
    const listed = (await tool.run(alice, { account_id: created.body.id })) as { summary: object };
    expect(listed.summary).toMatchObject({ excludedCount: 1 });
  });
});

describe("the card, the chart and «To review» as the pages compute them (client R3)", () => {
  it("answers what groupedBreakdown, spendingLayers, reviewTotals and categoryCounts give", async () => {
    const domain = await import("@ledgerly/domain/transactions");
    const account = await newAccount(alice);
    const category = async (name: string, parentId: string | null) =>
      (await send(alice, "POST", "/categories", { name, type: "expense", parentId, color: null })).body
        .id as string;
    const house = await category("House", null);
    const rent = await category("Rent", house);
    await manual(alice, account, { amount: "500", categoryId: rent, on: "2026-02-03" });
    await manual(alice, account, { amount: "100", categoryId: house, on: "2026-02-10" });
    await manual(alice, account, { amount: "20", on: "2026-02-10" });
    const range = { from: "2026-02-01", to: "2026-02-28" };

    const card = (
      await send(alice, "GET", `/transactions/spending/breakdown?from=${range.from}&to=${range.to}`)
    ).body;
    const expected = domain.groupedBreakdown(
      (await domain.spending(alice, range, "category")).map((slice) => ({
        id: slice.categoryId ?? "",
        name: slice.name ?? "",
        color: slice.color ?? "",
        cents: slice.totalCents,
        parentId: slice.parentId,
        parentName: slice.parentName,
        parentColor: slice.parentColor,
      })),
    );
    expect(card.total).toBe("620.00");
    const shape = (bar: { id: string; share: number; width: number }) => [
      bar.id || null,
      bar.share,
      bar.width,
    ];
    expect(card.groups.map((group: { id: string; share: number; width: number }) => shape(group))).toEqual(
      expected.groups.map(shape),
    );
    expect(card.groups[0]).toMatchObject({ id: house, name: "House", amount: "600.00" });
    expect(
      card.groups[0].children.map((child: { id: string; amount: string }) => [child.id, child.amount]),
    ).toEqual([
      [rent, "500.00"],
      [house, "100.00"],
    ]);

    const chart = (
      await send(alice, "GET", `/transactions/spending/series?from=${range.from}&to=${range.to}&grain=day`)
    ).body;
    const buckets = domain.spendingBuckets(range, "day", "2026-11-20");
    const layers = domain.spendingLayers(
      (await domain.spending(alice, range, "day")).map((point) => ({
        bucket: point.bucket ?? "",
        groupId: point.categoryId,
        cents: point.totalCents,
      })),
      buckets,
    );
    expect(chart.buckets.map((bucket: { bucket: string }) => bucket.bucket)).toEqual(buckets);
    expect(chart.buckets.map((bucket: { total: string }) => bucket.total)).toEqual(
      layers.totals.map((cents) => (Number(cents) / 100).toFixed(2)),
    );
    expect(
      chart.groups.map((group: { id: string | null; total: string }) => [group.id, group.total]),
    ).toEqual(layers.groups.map((group) => [group.id, (Number(group.total) / 100).toFixed(2)]));
    expect(chart.groups[0].values).toHaveLength(28);

    const review = (await send(alice, "GET", `/transactions/review?from=${range.from}&to=${range.to}`)).body;
    const accountIds = await domain.categorisableAccountIds(alice);
    const found =
      accountIds.length === 0
        ? { suggested: [], unsuggested: [], singles: [] }
        : await domain.reviewOf(alice, { ...range, accountIds });
    const totals = domain.reviewTotals(found);
    expect([review.count, review.total]).toEqual([
      totals.count,
      (Number(totals.totalCents) / 100).toFixed(2),
    ]);
    expect(review.counts).toEqual(await domain.categoryCounts(alice, accountIds));
  });
});

describe("the badges of a row (client R3)", () => {
  it("are the ones badgesOf gives the page, where hidden and edited say something else", async () => {
    const domain = await import("@ledgerly/domain/transactions");
    const { upsertFromProvider } = await import("@domain/modules/transactions/service");
    const { WALLET_PROVIDER } = await import("../../../../../test/fixtures/providers");
    const { getDb } = await import("@domain/platform/db/client");
    const { eq } = await import("drizzle-orm");
    const account = await newAccount(alice);
    const movement = (externalId: string) => ({
      externalId,
      counterpartExternalId: null,
      occurredAt: new Date("2026-02-10T09:00:00Z"),
      amountCents: -1250n,
      currency: "EUR",
      type: "expense" as const,
      state: "cleared" as const,
      payee: externalId,
      note: null,
      categoryExternalId: null,
      categoryName: null,
      categoryGroupExternalId: null,
      categoryGroupName: null,
      labels: [],
    });
    await upsertFromProvider(alice, account, [movement("gone"), movement("chosen")], {
      provider: WALLET_PROVIDER,
      window: { from: "2026-02-01", to: "2026-02-28" },
    });
    const rows = await domain.listTransactions(alice, { includeHidden: true });
    const id = (payee: string) => rows.find((row) => row.payee === payee)!.id;
    // Hidden by the person, then gone from the source.
    await send(alice, "POST", "/transactions/visibility", {
      ids: [id("gone")],
      change: "hide",
      rebuildBalances: false,
    });
    await getDb()
      .update(domain.transactions)
      .set({ removedUpstreamAt: new Date() })
      .where(eq(domain.transactions.id, id("gone")));
    // Only a category chosen where the source gives none (a movement with a category key).
    await getDb()
      .update(domain.transactions)
      .set({ categoryKey: "chosen" })
      .where(eq(domain.transactions.id, id("chosen")));
    const food = (
      await send(alice, "POST", "/categories", { name: "Food", type: "expense", parentId: null, color: null })
    ).body.id;
    expect(
      (await send(alice, "PUT", "/transactions/category", { ids: [id("chosen")], categoryId: food })).body,
    ).toEqual({
      count: 1,
    });

    const today = await domain.listTransactions(alice, {
      ids: [id("gone"), id("chosen")],
      includeHidden: true,
    });
    for (const [payee, badges, hidden, edited] of [
      ["gone", ["hidden", "removedUpstream"], true, false],
      ["chosen", [], false, true],
    ] as const) {
      const line = (await send(alice, "GET", `/transactions/${id(payee)}`)).body;
      expect(line.badges, payee).toEqual(domain.badgesOf(today.find((row) => row.payee === payee)!));
      expect([line.badges, line.hidden, line.edited], payee).toEqual([badges, hidden, edited]);
    }
  });
});

describe("the sign, the series' shares, the groups' counts and the macros (client R3)", () => {
  it("answers what groupedBreakdown, spendingLayers, share, groupCounts and macrosFor give", async () => {
    const domain = await import("@ledgerly/domain/transactions");
    const { centsToDecimal, share } = await import("@ledgerly/domain/shared/money");
    const account = await newAccount(alice);
    const category = async (name: string, parentId: string | null) =>
      (await send(alice, "POST", "/categories", { name, type: "expense", parentId, color: null })).body
        .id as string;
    const house = await category("House", null);
    const rent = await category("Rent", house);
    const spent = await manual(alice, account, { amount: "500", categoryId: rent, on: "2026-02-03" });
    await manual(alice, account, { amount: "100", categoryId: house, on: "2026-02-10" });
    const earned = await manual(alice, account, { kind: "income", amount: "30", on: "2026-02-11" });
    const range = { from: "2026-02-01", to: "2026-02-28" };
    const query = `from=${range.from}&to=${range.to}`;

    // 1. The amount with its sign, as groupedBreakdown keeps it.
    const card = (await send(alice, "GET", `/transactions/spending/breakdown?${query}`)).body;
    const expected = domain.groupedBreakdown(
      (await domain.spending(alice, range, "category")).map((slice) => ({
        id: slice.categoryId ?? "",
        name: slice.name ?? "",
        color: slice.color ?? "",
        cents: slice.totalCents,
        parentId: slice.parentId,
        parentName: slice.parentName,
        parentColor: slice.parentColor,
      })),
    );
    type Bar = { signedAmount: string; children: { signedAmount: string }[] };
    expect(
      card.groups.map((group: Bar) => [group.signedAmount, group.children.map((one) => one.signedAmount)]),
    ).toEqual(
      expected.groups.map((group) => [
        centsToDecimal(group.cents),
        group.children.map((one) => centsToDecimal(one.cents)),
      ]),
    );
    expect(card.groups[0]).toMatchObject({ id: house, amount: "600.00", signedAmount: "-600.00" });

    // 2. The series' total and each group's share of it.
    const chart = (await send(alice, "GET", `/transactions/spending/series?${query}&grain=day`)).body;
    const layers = domain.spendingLayers(
      (await domain.spending(alice, range, "day")).map((point) => ({
        bucket: point.bucket ?? "",
        groupId: point.categoryId,
        cents: point.totalCents,
      })),
      domain.spendingBuckets(range, "day", "2026-11-20"),
    );
    const total = layers.totals.reduce((sum, cents) => sum + cents, 0n);
    expect(chart.total).toBe(centsToDecimal(total));
    expect(chart.groups.map((group: { share: number }) => group.share)).toEqual(
      layers.groups.map((group) => share(group.total, total) ?? 0),
    );

    // 3. A group counts its own movements and its sub-categories' (F2.5).
    const view = (await send(alice, "GET", `/transactions/view?${query}`)).body;
    expect(view.facets.groups).toEqual(
      domain.groupCounts(
        await domain.listCategories(alice),
        (await domain.facetCounts(alice, range)).categories,
      ),
    );
    expect(view.facets.groups).toEqual([{ categoryId: house, count: 2 }]);

    // 4. The macros a category may be chosen in: by the sign, and `transfer` only for a pair.
    const { upsertFromProvider } = await import("@domain/modules/transactions/service");
    const { WALLET_PROVIDER } = await import("../../../../../test/fixtures/providers");
    const other = await newAccount(alice, "Revolut");
    const leg = (accountId: string, externalId: string, counterpart: string, amountCents: bigint) =>
      upsertFromProvider(
        alice,
        accountId,
        [
          {
            externalId,
            counterpartExternalId: counterpart,
            occurredAt: new Date("2026-02-12T09:00:00Z"),
            amountCents,
            currency: "EUR",
            type: "transfer" as const,
            state: "cleared" as const,
            payee: externalId,
            note: null,
            categoryExternalId: null,
            categoryName: null,
            categoryGroupExternalId: null,
            categoryGroupName: null,
            labels: [],
          },
        ],
        { provider: WALLET_PROVIDER },
      );
    await leg(account, "w-1", "w-2", -5000n);
    await leg(other, "w-2", "w-1", 5000n);
    const rows = await domain.listTransactions(alice, { includeHidden: true });
    const legs = rows.filter((row) => row.transferGroupId !== null);
    expect(legs).toHaveLength(2);
    for (const [id, macros] of [
      [spent.id, ["expense", "transfer"]],
      [earned.id, ["income", "transfer"]],
      [legs[0].id, ["transfer"]],
      [legs[1].id, ["transfer"]],
    ] as const) {
      const line = (await send(alice, "GET", `/transactions/${id}`)).body;
      expect(line.macros).toEqual(domain.macrosFor(rows.find((row) => row.id === id)!));
      expect(line.macros).toEqual(macros);
    }
  });
});

describe("the figures of a category's page (client R3)", () => {
  it("answers what categorySummary gives the page: a group, an empty period before, one month", async () => {
    const domain = await import("@ledgerly/domain/transactions");
    const { budgetDetail, setLimit } = await import("@ledgerly/domain/budgets");
    const { centsToDecimal } = await import("@ledgerly/domain/shared/money");
    const account = await newAccount(alice);
    const category = async (name: string, parentId: string | null) =>
      (await send(alice, "POST", "/categories", { name, type: "expense", parentId, color: null })).body
        .id as string;
    const house = await category("House", null);
    const rent = await category("Rent", house);
    await manual(alice, account, { amount: "500", categoryId: rent, on: "2026-02-03" });
    await manual(alice, account, { amount: "100", categoryId: house, on: "2026-02-10" });
    await setLimit(alice, { categoryId: house, accountId: null, month: "2026-02-01", cents: 50_000n });
    const summaryOf = async (from: string, to: string) =>
      (await send(alice, "GET", `/categories/${house}/summary?from=${from}&to=${to}`)).body;

    // February alone: one month, and January before it has no movement.
    const february = await summaryOf("2026-02-01", "2026-02-28");
    const scope = { categoryIds: [house] };
    const all = await domain.listCategories(alice, { includeArchived: true });
    const totals = await domain.categoryMacroTotals(alice, {
      ...scope,
      from: "2026-02-01",
      to: "2026-02-28",
    });
    const budget = await budgetDetail(alice, { categoryId: house, accountId: null }, "2026-02-01");
    const page = domain.categorySummary({
      category: { id: house, type: "expense" },
      categories: all,
      totals,
      before: await domain.categoryMacroTotals(alice, { ...scope, from: "2026-01-01", to: "2026-01-31" }),
      months: 1,
      budget: budget && { ...budget, from: "2026-02-01", end: "2026-02-01" },
    });
    expect(february).toEqual({
      amount: centsToDecimal(page.amountCents),
      count: page.count,
      previousAmount: null,
      change: null,
      perMonth: null,
      budget: { limit: centsToDecimal(page.budget!.limitCents), overMonths: page.budget!.overMonths },
      children: page.children.map((line) => ({
        id: line.category.id,
        name: line.category.name,
        color: null,
        amount: centsToDecimal(line.totalCents),
        share: line.share / 100,
      })),
      source: null,
    });
    expect(february).toMatchObject({
      amount: "600.00",
      count: 2,
      budget: { limit: "500.00", overMonths: 1 },
    });
    expect(february.children).toEqual([
      { id: rent, name: "Rent", color: null, amount: "-500.00", share: 0.833 },
    ]);

    // March with February before it: the change, and two months for the amount by month.
    await manual(alice, account, { amount: "300", categoryId: rent, on: "2026-03-05" });
    const march = await summaryOf("2026-03-01", "2026-03-31");
    expect([march.amount, march.previousAmount, march.change]).toEqual(["300.00", "600.00", -0.5]);
    expect((await summaryOf("2026-02-01", "2026-03-31")).perMonth).toBe("450.00");
    expect(
      (await send(bob, "GET", `/categories/${house}/summary?from=2026-02-01&to=2026-02-28`)).status,
    ).toBe(404);
  });

  it("names the source whose categories count under it, as the page's note", async () => {
    const { applyProviderAccounts } = await import("@domain/modules/accounts/service");
    const { listAccounts } = await import("@domain/modules/accounts/queries");
    const { upsertFromProvider } = await import("@domain/modules/transactions/service");
    const { sourceNotes } = await import("@/app/(app)/settings/finance/source");
    const domain = await import("@ledgerly/domain/transactions");
    await applyProviderAccounts(alice, "plugin:wallet", [
      {
        provider: "plugin:wallet",
        providerAccountId: "acc-1",
        name: "Current",
        type: "checking",
        currency: "EUR",
      },
    ]);
    const [account] = await listAccounts(alice);
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
      alice,
      account.id,
      [incoming("e-1", "Tobacco"), incoming("e-2", "Alcohol, tobacco")],
      {
        provider: "plugin:wallet",
      },
    );
    const alcohol = (await domain.listCategories(alice)).find((one) => one.name === "Alcohol, tobacco")!;
    const tobacco = (await send(alice, "GET", "/source-categories")).body.sourceCategories.find(
      (one: { name: string }) => one.name === "Tobacco",
    );
    expect(
      (await send(alice, "PUT", `/source-categories/${tobacco.id}`, { categoryId: alcohol.id })).status,
    ).toBe(200);

    const note = (await sourceNotes(alice)).get(alcohol.id)!;
    const answer = (
      await send(alice, "GET", `/categories/${alcohol.id}/summary?from=2026-02-01&to=2026-02-28`)
    ).body;
    expect(answer.source).toEqual({ provider: note.provider, name: note.source, names: note.names });
    expect(answer.source.names).toEqual(["Alcohol, tobacco", "Tobacco"]);
  });
});

describe("what is left of «To review» (client R3)", () => {
  it("answers left as the page reads it: suggested and open", async () => {
    const domain = await import("@ledgerly/domain/transactions");
    const review = (await send(alice, "GET", "/transactions/review")).body;
    const counts = await domain.categoryCounts(alice, review.accountIds);
    expect(review.counts).toEqual(counts);
    expect(review.counts.left).toBe(counts.suggested + counts.open);
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
      count: 0,
      total: "0.00",
      counts: { categorised: 0, suggested: 0, open: 0, left: 0 },
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
