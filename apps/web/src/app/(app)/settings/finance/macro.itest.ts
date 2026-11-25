import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@domain/modules/accounts/service";
import { budgetsView } from "@domain/modules/budgets/queries";
import { setLimit } from "@domain/modules/budgets/service";
import { movementsOutOfLine } from "@domain/modules/transactions/macro";
import { createManualTransaction } from "@domain/modules/transactions/manual";
import { transactionsSummary } from "@domain/modules/transactions/queries";
import { createCategory, getCategory } from "@domain/modules/transactions/taxonomy";
import type { Ctx } from "@domain/platform/context";
import { monthKey, today } from "@domain/shared/dates";
import { getDb } from "@domain/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";
import { macroMoveView, moveToMacro, undoMoveToMacro } from "./macro";

// "Move to another section" (categories-and-rules.md §5.6): the category changes macro, the movements
// keep counting by their sign (a category never makes a giroconto, 2026-11-25), the budget stops
// (QC8), and "Undo" puts every number back.

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
const TODAY = today("Europe/Rome");
const MONTH = monthKey(TODAY);

let ctx: Ctx;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
});
afterAll(closeDatabase);

async function savingsGroup() {
  const group = await createCategory(ctx, { name: "Savings", type: "expense" });
  const deposit = await createCategory(ctx, { name: "Deposit", type: "expense", parentId: group.id });
  const food = await createCategory(ctx, { name: "Food", type: "expense" });
  const account = await createAccount(ctx, { name: "Cash", type: "cash" });
  for (const [categoryId, kind, amountCents] of [
    [deposit.id, "expense", 30_000n],
    [group.id, "expense", 5_000n],
    [deposit.id, "income", 1_000n],
    [food.id, "expense", 2_000n],
  ] as const) {
    await createManualTransaction(ctx, {
      kind,
      amountCents,
      on: TODAY,
      accountId: account.id,
      categoryId,
      payee: "Shop",
      note: "",
    });
  }
  await setLimit(ctx, { categoryId: group.id, accountId: null, month: MONTH, cents: 40_000n });
  return { group, deposit, food, account };
}

const numbers = async (accountId: string) => {
  const summary = await transactionsSummary(ctx, { from: TODAY, to: TODAY, accountIds: [accountId] });
  const budgets = await budgetsView(ctx, MONTH);
  return { summary, budgets: budgets.rows.map((row) => [row.limitCents, row.spentCents]) };
};

describe("moving a group to Income", () => {
  it("says what changes before the move", async () => {
    const { group } = await savingsGroup();
    const view = await macroMoveView(ctx, group.id);
    expect(view).toMatchObject({
      from: "expense",
      count: 2,
      amountCents: 35_000n,
      firstYear: Number(TODAY.slice(0, 4)),
      stopsBudget: true,
      linked: { subscriptions: 0, pockets: 0, interests: 0 },
      sources: [],
    });
  });

  it("keeps the money where the sign puts it, stops the budget, and Undo puts every number back", async () => {
    const { group, deposit, account } = await savingsGroup();
    const before = await numbers(account.id);

    const undo = await moveToMacro(ctx, group.id, { type: "income", parentId: null });
    const after = await numbers(account.id);
    expect((await getCategory(ctx, deposit.id)).type).toBe("income");
    // A category never makes a giroconto: the movements count by their sign, as before.
    expect(after.summary).toEqual(before.summary);
    expect(after.budgets).toEqual([]);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);

    await undoMoveToMacro(ctx, undo);
    expect(await numbers(account.id)).toEqual(before);
    expect((await getCategory(ctx, deposit.id)).type).toBe("expense");
  });

  it("refuses a category in a group, a group of Transfers, and a group of the other macro as the place", async () => {
    const { deposit, food } = await savingsGroup();
    await expect(moveToMacro(ctx, deposit.id, { type: "income", parentId: null })).rejects.toThrow();
    await expect(createCategory(ctx, { name: "Card", type: "transfer" })).rejects.toThrow();
    const work = await createCategory(ctx, { name: "Work", type: "income" });
    await expect(moveToMacro(ctx, food.id, { type: "expense", parentId: work.id })).rejects.toThrow();
  });

  it("refuses an Undo that names another person's category", async () => {
    const { group } = await savingsGroup();
    const undo = await moveToMacro(ctx, group.id, { type: "income", parentId: null });
    const other = contextFor((await createTestUser()).id);
    await expect(undoMoveToMacro(other, undo)).rejects.toThrow();
  });
});
