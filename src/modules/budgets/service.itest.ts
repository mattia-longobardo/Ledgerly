import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { removeAccount } from "@/modules/accounts/service";
import { listTransactions } from "@/modules/transactions/queries";
import { hideTransaction, upsertFromProvider } from "@/modules/transactions/service";
import { createCategory, listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { anAccount, movement, newContext } from "../../../test/fixtures";
import { budgetsView } from "./queries";
import { BudgetError, setLimit, stopLimit } from "./service";

let ctx: Ctx;
let accountId: string;

async function categoryId(name: string): Promise<string> {
  const found = (await listCategories(ctx)).find((category) => category.name === name);
  if (!found) throw new Error(`no category ${name}`);
  return found.id;
}

beforeEach(async () => {
  await resetDatabase();
  ctx = await newContext();
  accountId = await anAccount(ctx);
});

afterAll(closeDatabase);

describe("spent (spec §7.3)", () => {
  it("counts the month's visible expenses of the category and nothing else", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({ amountCents: -10_000n }),
      movement({ amountCents: -2_550n, occurredAt: new Date("2026-03-31T22:30:00Z") }), // 00:30 on 1 April in Rome (CEST)
      movement({ amountCents: -1_000n, occurredAt: new Date("2026-02-28T23:30:00Z") }), // 00:30 on 1 March in Rome (CET)
      movement({ amountCents: 3_000n, type: "income", payee: "Refund" }),
      movement({ amountCents: -7_000n, type: "transfer", payee: "Giroconto" }),
      movement({ amountCents: -500n, payee: "Hidden" }),
    ]);
    const hidden = (await listTransactions(ctx, {})).find((row) => row.payee === "Hidden");
    await hideTransaction(ctx, hidden!.id);
    const groceries = await categoryId("Groceries");
    await setLimit(ctx, { categoryId: groceries, accountId: null, month: "2026-03-01", cents: 12_000n });

    const view = await budgetsView(ctx, "2026-03-01");
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({
      spentCents: 11_000n,
      limitCents: 12_000n,
      status: "near",
      percent: 92,
    });
    expect(view.totals).toEqual({ limitCents: 12_000n, spentCents: 11_000n });
  });

  it("gives a group the spending of its sub-categories", async () => {
    await upsertFromProvider(ctx, accountId, [
      movement({
        amountCents: -4_000n,
        categoryName: "Rent",
        categoryGroupName: "Home",
        categoryGroupExternalId: "g-1",
      }),
      movement({
        amountCents: -1_500n,
        categoryName: "Bills",
        categoryGroupName: "Home",
        categoryGroupExternalId: "g-1",
      }),
    ]);
    await setLimit(ctx, {
      categoryId: await categoryId("Home"),
      accountId: null,
      month: "2026-03-01",
      cents: 5_000n,
    });
    await setLimit(ctx, {
      categoryId: await categoryId("Rent"),
      accountId: null,
      month: "2026-03-01",
      cents: 3_000n,
    });

    const view = await budgetsView(ctx, "2026-03-01");
    expect(view.rows.map((row) => [row.name, row.spentCents, row.status, row.depth])).toEqual([
      ["Home", 5_500n, "over", 0],
      ["Rent", 4_000n, "over", 1],
    ]);
    expect(view.totals).toEqual({ limitCents: 5_000n, spentCents: 5_500n });
    expect(view.unbudgetedCents).toBe(0n);
  });
});

describe("versions", () => {
  it("applies a limit from its month onwards and replaces the later versions", async () => {
    const id = (await createCategory(ctx, { name: "Fun" })).id;
    await setLimit(ctx, { categoryId: id, accountId: null, month: "2026-01-01", cents: 10_000n });
    await setLimit(ctx, { categoryId: id, accountId: null, month: "2026-06-01", cents: 30_000n });
    await setLimit(ctx, { categoryId: id, accountId: null, month: "2026-03-01", cents: 20_000n });

    const limitIn = async (month: string) => (await budgetsView(ctx, month)).rows[0]?.limitCents ?? null;
    expect(await limitIn("2025-12-01")).toBeNull();
    expect(await limitIn("2026-02-01")).toBe(10_000n);
    expect(await limitIn("2026-03-01")).toBe(20_000n);
    expect(await limitIn("2026-07-01")).toBe(20_000n);
    expect((await budgetsView(ctx, "2026-07-01")).firstMonth).toBe("2026-01-01");
  });

  it("stops a budget from a month on, and leaves nothing when stopped in its first month", async () => {
    const id = (await createCategory(ctx, { name: "Fun" })).id;
    await setLimit(ctx, { categoryId: id, accountId: null, month: "2026-01-01", cents: 10_000n });
    await stopLimit(ctx, { categoryId: id, accountId: null, month: "2026-04-01" });
    expect((await budgetsView(ctx, "2026-03-01")).rows).toHaveLength(1);
    expect((await budgetsView(ctx, "2026-04-01")).rows).toHaveLength(0);

    await stopLimit(ctx, { categoryId: id, accountId: null, month: "2026-01-01" });
    expect((await budgetsView(ctx, "2026-03-01")).rows).toHaveLength(0);
    expect((await budgetsView(ctx, "2026-03-01")).firstMonth).toBeNull();
  });

  it("refuses an income category, a non-positive amount and a month that is not a first", async () => {
    const salary = (await createCategory(ctx, { name: "Salary", type: "income" })).id;
    const fun = (await createCategory(ctx, { name: "Fun" })).id;
    await expect(
      setLimit(ctx, { categoryId: salary, accountId: null, month: "2026-01-01", cents: 1n }),
    ).rejects.toThrow(BudgetError);
    await expect(
      setLimit(ctx, { categoryId: fun, accountId: null, month: "2026-01-01", cents: 0n }),
    ).rejects.toThrow();
    await expect(
      setLimit(ctx, { categoryId: fun, accountId: null, month: "2026-01-15", cents: 1n }),
    ).rejects.toThrow();
  });
});

describe("budgets on an account (F3)", () => {
  it("counts only the account's spending, whole or in one category, and archives the account it points at", async () => {
    const other = await anAccount(ctx, "Revolut");
    await upsertFromProvider(ctx, accountId, [
      movement({ amountCents: -4_000n, occurredAt: new Date("2026-03-10T10:00:00Z") }),
    ]);
    await upsertFromProvider(ctx, other, [
      movement({ amountCents: -1_500n, occurredAt: new Date("2026-03-11T10:00:00Z") }),
      movement({ amountCents: -700n, categoryName: "Fun", occurredAt: new Date("2026-03-12T10:00:00Z") }),
    ]);
    const groceries = await categoryId("Groceries");
    await setLimit(ctx, { categoryId: groceries, accountId: other, month: "2026-03-01", cents: 2_000n });
    await setLimit(ctx, { categoryId: null, accountId: other, month: "2026-03-01", cents: 3_000n });
    await setLimit(ctx, { categoryId: groceries, accountId: null, month: "2026-03-01", cents: 6_000n });

    const view = await budgetsView(ctx, "2026-03-01");
    expect(view.rows.map((row) => [row.name, row.accountName, row.spentCents])).toEqual([
      [null, "Revolut", 2_200n],
      ["Groceries", null, 5_500n],
      ["Groceries", "Revolut", 1_500n],
    ]);
    // "Groceries on Revolut" sits inside both others; the two outer ones add up, each movement once.
    expect(view.totals).toEqual({ limitCents: 9_000n, spentCents: 6_200n });
    expect(view.unbudgetedCents).toBe(0n);

    await stopLimit(ctx, { categoryId: null, accountId: other, month: "2026-03-01" });
    expect((await budgetsView(ctx, "2026-03-01")).rows).toHaveLength(2);
    expect(await removeAccount(ctx, other)).toBe("archived");
  });

  it("needs a category or an account", async () => {
    await expect(
      setLimit(ctx, { categoryId: null, accountId: null, month: "2026-03-01", cents: 1n }),
    ).rejects.toThrow();
  });
});

describe("isolation between users (spec §4.4, §11)", () => {
  it("never reads, sets or stops a budget on another user's category or account", async () => {
    const fun = (await createCategory(ctx, { name: "Fun" })).id;
    await setLimit(ctx, { categoryId: fun, accountId: null, month: "2026-01-01", cents: 10_000n });
    const other = await newContext();

    expect((await budgetsView(other, "2026-01-01")).rows).toEqual([]);
    expect((await budgetsView(other, "2026-01-01")).firstMonth).toBeNull();
    await expect(
      setLimit(other, { categoryId: fun, accountId: null, month: "2026-01-01", cents: 1n }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      stopLimit(other, { categoryId: fun, accountId: null, month: "2026-01-01" }),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    // Nor on another user's account.
    await expect(
      setLimit(other, { categoryId: null, accountId, month: "2026-01-01", cents: 1n }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await budgetsView(ctx, "2026-01-01")).rows[0].limitCents).toBe(10_000n);
  });
});
