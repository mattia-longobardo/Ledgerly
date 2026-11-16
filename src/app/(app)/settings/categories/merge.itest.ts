import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAccount } from "@/modules/accounts/service";
import { budgetsView } from "@/modules/budgets/queries";
import { setLimit } from "@/modules/budgets/service";
import { createManualTransaction } from "@/modules/transactions/manual";
import { dismissMergeProposal, listMergeProposals } from "@/modules/transactions/categorize/review";
import { listTransactions } from "@/modules/transactions/queries";
import { createCategory, listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { monthKey, today } from "@/platform/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { createTestUser } from "../../../../../test/users";
import { mergeProposalsView, mergeTwoCategories } from "./merge";

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
