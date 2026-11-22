import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@domain/modules/accounts/service";
import { budgetsView } from "@domain/modules/budgets/queries";
import { setLimit } from "@domain/modules/budgets/service";
import { createManualTransaction } from "@domain/modules/transactions/manual";
import { dismissMergeProposal, listMergeProposals } from "@domain/modules/transactions/categorize/review";
import {
  categoryMacroTotals,
  listTransactions,
  transactionsSummary,
} from "@domain/modules/transactions/queries";
import {
  archiveCategory,
  createCategory,
  getCategory,
  listCategories,
  moveCategory,
  restoreCategories,
} from "@domain/modules/transactions/taxonomy";
import { macroViews } from "@ledgerly/domain/transactions";
import type { Ctx } from "@domain/platform/context";
import { monthKey, today } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../../../test/db";
import { createTestUser } from "../../../../../../../test/users";
import { mergeProposalsView, mergeTwoCategories, undoMergeOfTwo } from "./merge";

// The merge of two categories that look the same (rewrite plan N3; ux §6.3): movements, budgets
// and sub-categories move together, or nothing does.

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
const newContext = async () => contextFor((await createTestUser()).id);
const TODAY = today("Europe/Rome");
const MONTH = monthKey(TODAY);

async function twoCategories(ctx: Ctx) {
  const tobacco = await createCategory(ctx, { name: "Tobacco" });
  const both = await createCategory(ctx, { name: "Alcohol, tobacco" });
  const account = await createAccount(ctx, { name: "Cash", type: "cash" });
  for (const [categoryId, amountCents] of [
    [tobacco.id, 500n],
    [tobacco.id, 700n],
    [both.id, 1_000n],
  ] as const) {
    await createManualTransaction(ctx, {
      kind: "expense",
      amountCents,
      on: TODAY,
      accountId: account.id,
      categoryId,
      payee: "Shop",
      note: "",
    });
  }
  return { tobacco, both, account };
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("the proposals to merge", () => {
  it("name the two categories with their movements, and whether two budgets are summed", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    const [first] = await mergeProposalsView(ctx);
    expect([first.first.id, first.second.id].sort()).toEqual([tobacco.id, both.id].sort());
    expect(first.first.usage + first.second.usage).toBe(3);
    expect(first.sumsBudgets).toBe(false);

    await setLimit(ctx, { categoryId: tobacco.id, accountId: null, month: MONTH, cents: 2_000n });
    await setLimit(ctx, { categoryId: both.id, accountId: null, month: MONTH, cents: 5_000n });
    expect((await mergeProposalsView(ctx))[0].sumsBudgets).toBe(true);
  });

  it("do not come back for a pair the person said is two things, and are nobody else's", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    expect(await listMergeProposals(await newContext())).toEqual([]);
    await dismissMergeProposal(ctx, both.id, tobacco.id);
    expect(await listMergeProposals(ctx)).toEqual([]);
  });
});

describe("mergeTwoCategories", () => {
  it("moves the movements, archives the one that goes and sums the two limits (decision H35 point 7)", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    await setLimit(ctx, { categoryId: tobacco.id, accountId: null, month: MONTH, cents: 2_000n });
    await setLimit(ctx, { categoryId: both.id, accountId: null, month: MONTH, cents: 5_000n });

    const { moved } = await mergeTwoCategories(ctx, { keepId: both.id, dropId: tobacco.id });

    expect(moved).toBe(2);
    expect((await listTransactions(ctx)).every((row) => row.categoryId === both.id)).toBe(true);
    expect((await listCategories(ctx)).map((category) => category.name)).toEqual(["Alcohol, tobacco"]);
    const view = await budgetsView(ctx, MONTH);
    expect(view.rows).toHaveLength(1);
    expect(view.rows[0]).toMatchObject({ limitCents: 7_000n, spentCents: 2_200n });
    expect(await listMergeProposals(ctx)).toEqual([]);
  });

  it("gives the one that stays the other's limit when it had none", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    await setLimit(ctx, { categoryId: tobacco.id, accountId: null, month: MONTH, cents: 2_000n });

    await mergeTwoCategories(ctx, { keepId: both.id, dropId: tobacco.id });

    expect((await budgetsView(ctx, MONTH)).rows[0]).toMatchObject({ limitCents: 2_000n });
  });

  it("moves the sub-categories of a group under the group that stays", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    const child = await createCategory(ctx, { name: "Cigars", parentId: tobacco.id });

    await mergeTwoCategories(ctx, { keepId: both.id, dropId: tobacco.id });

    expect((await listCategories(ctx)).find((category) => category.id === child.id)?.parentId).toBe(both.id);
  });

  it("changes nothing when it is refused: two kinds, the same category, somebody else's", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    await setLimit(ctx, { categoryId: tobacco.id, accountId: null, month: MONTH, cents: 2_000n });
    const income = await createCategory(ctx, { name: "Refunds", type: "income" });
    const stranger = await newContext();

    await expect(mergeTwoCategories(ctx, { keepId: income.id, dropId: tobacco.id })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(mergeTwoCategories(ctx, { keepId: both.id, dropId: both.id })).rejects.toMatchObject({
      code: "invalid",
    });
    await expect(mergeTwoCategories(stranger, { keepId: both.id, dropId: tobacco.id })).rejects.toMatchObject(
      {
        code: "not_found",
      },
    );

    // The limit that was read before the refusal is where it was: one transaction, all or nothing.
    expect((await budgetsView(ctx, MONTH)).rows[0]).toMatchObject({ limitCents: 2_000n });
    expect((await listCategories(ctx)).map((category) => category.name).sort()).toEqual([
      "Alcohol, tobacco",
      "Refunds",
      "Tobacco",
    ]);
  });
});

// Expenses › Categories (categories-and-rules.md §5, N3.2): the totals are the header of Expenses,
// and moving, merging and archiving have their "Undo".
describe("the page of the categories", () => {
  it("totals each macro as the header of Expenses does, for the same days and accounts", async () => {
    const ctx = await newContext();
    const { tobacco, account } = await twoCategories(ctx);
    const work = await createCategory(ctx, { name: "Work", type: "income" });
    const salary = await createCategory(ctx, { name: "Salary", parentId: work.id, type: "income" });
    for (const [kind, categoryId, amountCents] of [
      ["income", salary.id, 300_000n],
      // A refund filed under an expense category: it counts as income until N3.3 (§5.3).
      ["income", tobacco.id, 200n],
      ["expense", null, 900n],
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
    const filters = { from: TODAY, to: TODAY, accountIds: [account.id] };
    const [summary, totals, categories] = await Promise.all([
      transactionsSummary(ctx, filters),
      categoryMacroTotals(ctx, filters),
      listCategories(ctx, { includeArchived: true }),
    ]);
    const [income, expense] = macroViews(
      categories.map((one) => ({ ...one, archived: one.archivedAt !== null })),
      totals,
    );
    expect(expense.totalCents).toBe(summary.expenseCents);
    expect(income.totalCents).toBe(summary.incomeCents);
    expect(expense.rest?.count).toBe(1);
    // Nobody else's movements reach the page.
    expect(await categoryMacroTotals(await newContext(), filters)).toEqual([]);
  });

  it("archives a group with its categories, and Undo brings every one of them back", async () => {
    const ctx = await newContext();
    const home = await createCategory(ctx, { name: "Home" });
    const rent = await createCategory(ctx, { name: "Rent", parentId: home.id });
    const bills = await createCategory(ctx, { name: "Bills", parentId: home.id });
    await archiveCategory(ctx, bills.id);

    const ids = await archiveCategory(ctx, home.id);
    expect(ids.sort()).toEqual([home.id, rent.id].sort());
    expect(await listCategories(ctx)).toEqual([]);

    await restoreCategories(ctx, ids);
    expect((await listCategories(ctx)).map((one) => one.name)).toEqual(["Home", "Rent"]);
    // The one archived before stays put away, and nobody else can restore these.
    expect((await getCategory(ctx, bills.id)).archivedAt).not.toBeNull();
    await archiveCategory(ctx, home.id);
    expect(await restoreCategories(await newContext(), ids)).toBe(0);
  });

  it("moves a category to a group of the same macro only, and back with Undo", async () => {
    const ctx = await newContext();
    const home = await createCategory(ctx, { name: "Home" });
    const bills = await createCategory(ctx, { name: "Bills" });
    const power = await createCategory(ctx, { name: "Power", parentId: home.id });
    const work = await createCategory(ctx, { name: "Work", type: "income" });

    const { fromId } = await moveCategory(ctx, power.id, bills.id);
    expect(fromId).toBe(home.id);
    expect((await getCategory(ctx, power.id)).parentId).toBe(bills.id);
    await expect(moveCategory(ctx, power.id, work.id)).rejects.toMatchObject({ code: "invalid_parent" });

    await moveCategory(ctx, power.id, fromId);
    expect((await getCategory(ctx, power.id)).parentId).toBe(home.id);
  });

  it("undoes a merge: movements, budgets and the category come back as they were", async () => {
    const ctx = await newContext();
    const { tobacco, both } = await twoCategories(ctx);
    await setLimit(ctx, { categoryId: tobacco.id, accountId: null, month: MONTH, cents: 2_000n });
    await setLimit(ctx, { categoryId: both.id, accountId: null, month: MONTH, cents: 5_000n });
    const before = await listTransactions(ctx);

    const { undo } = await mergeTwoCategories(ctx, { keepId: both.id, dropId: tobacco.id });
    // As the browser keeps it, and sends it back.
    const moved = await undoMergeOfTwo(ctx, JSON.parse(JSON.stringify(undo)));

    expect(moved).toBe(2);
    const after = await listTransactions(ctx);
    expect(after.map((row) => [row.id, row.categoryId]).sort()).toEqual(
      before.map((row) => [row.id, row.categoryId]).sort(),
    );
    expect((await listCategories(ctx)).map((one) => one.name).sort()).toEqual([
      "Alcohol, tobacco",
      "Tobacco",
    ]);
    const view = await budgetsView(ctx, MONTH);
    expect(view.rows.map((row) => [row.categoryId, row.limitCents]).sort()).toEqual(
      [
        [tobacco.id, 2_000n],
        [both.id, 5_000n],
      ].sort(),
    );
    // Somebody else cannot replay it.
    await expect(undoMergeOfTwo(await newContext(), undo)).rejects.toMatchObject({ code: "not_found" });
  });
});
