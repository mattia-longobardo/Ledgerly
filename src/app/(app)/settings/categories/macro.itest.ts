import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import { budgetsView } from "@/modules/budgets/queries";
import { setLimit } from "@/modules/budgets/service";
import { movementsOutOfLine } from "@/modules/transactions/macro";
import { createManualTransaction } from "@/modules/transactions/manual";
import { transactionsSummary } from "@/modules/transactions/queries";
import { createCategory, getCategory } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { macroMoveView, moveToMacro, undoMoveToMacro } from "./macro";

// "Move to another section" (categories-and-rules.md §5.6, N3.3): the movements count as the macro
// of arrival says, the budget stops (QC8), and "Undo" puts every number back.

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

describe("moving a group to Transfers", () => {
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

  it("takes its movements out of income and expenses, keeps the net, and Undo puts every number back", async () => {
    const { group, deposit, account } = await savingsGroup();
    const before = await numbers(account.id);

    const undo = await moveToMacro(ctx, group.id, { type: "transfer", parentId: null });
    const after = await numbers(account.id);
    expect((await getCategory(ctx, deposit.id)).type).toBe("transfer");
    expect(after.summary.expenseCents).toBe(before.summary.expenseCents + 35_000n);
    expect(after.summary.incomeCents).toBe(before.summary.incomeCents - 1_000n);
    expect(after.summary.netCents).toBe(before.summary.netCents);
    expect(after.summary.count).toBe(before.summary.count);
    expect(after.budgets).toEqual([]);
    expect(await movementsOutOfLine(getDb(), ctx)).toBe(0);

    await undoMoveToMacro(ctx, undo);
    expect(await numbers(account.id)).toEqual(before);
    expect((await getCategory(ctx, deposit.id)).type).toBe("expense");
  });

  it("refuses a category in a group, and a group of Transfers as the place of arrival", async () => {
    const { deposit, food } = await savingsGroup();
    await expect(moveToMacro(ctx, deposit.id, { type: "transfer", parentId: null })).rejects.toThrow();
    const transfers = await createCategory(ctx, { name: "Card", type: "transfer" });
    await expect(moveToMacro(ctx, food.id, { type: "transfer", parentId: transfers.id })).rejects.toThrow();
  });

  it("refuses an Undo that names another person's category", async () => {
    const { group } = await savingsGroup();
    const undo = await moveToMacro(ctx, group.id, { type: "transfer", parentId: null });
    const other = contextFor((await createTestUser()).id);
    await expect(undoMoveToMacro(other, undo)).rejects.toThrow();
  });
});
