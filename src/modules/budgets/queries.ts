import "server-only";
import { and, asc, lte, min } from "drizzle-orm";
import { listAccounts } from "@/modules/accounts/queries";
import { monthSpending } from "@/modules/transactions/queries";
import { categoryOptions, listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import type { MonthKey } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { type BudgetRow, budgetRows, type BudgetScope, type LimitVersion, limitFor, scopeKey } from "./rules";
import { budgetLimits } from "./schema";

export interface BudgetOption {
  id: string;
  name: string;
  color: string;
  depth: 0 | 1;
}

export interface BudgetsView {
  month: MonthKey;
  rows: BudgetRow[];
  totals: { limitCents: Cents; spentCents: Cents };
  unbudgetedCents: Cents;
  /** What "Add budget" offers: the open spending categories and the open accounts. */
  categories: BudgetOption[];
  accounts: { id: string; name: string }[];
  /** The month of the first limit ever set, `null` with none: where the stepper stops going back. */
  firstMonth: MonthKey | null;
}

/**
 * Everything Budgets renders for one month (spec §7.3, F3), computed on read: the versions in force
 * per scope (category, account or both), one aggregate query of the month's spending per category
 * and account, the tree and the accounts.
 */
export async function budgetsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  month: MonthKey,
): Promise<BudgetsView> {
  const [versions, spending, tree, accounts, options, first] = await Promise.all([
    getDb()
      .select({
        categoryId: budgetLimits.categoryId,
        accountId: budgetLimits.accountId,
        fromMonth: budgetLimits.fromMonth,
        amountCents: budgetLimits.amountCents,
        stopped: budgetLimits.stopped,
      })
      .from(budgetLimits)
      .where(and(userScoped(ctx).owns(budgetLimits), lte(budgetLimits.fromMonth, month)))
      .orderBy(asc(budgetLimits.categoryId), asc(budgetLimits.accountId), asc(budgetLimits.fromMonth)),
    monthSpending(ctx, month),
    // Archived too: a limit set before a category was archived still has spending to show.
    listCategories(ctx, { includeArchived: true }),
    listAccounts(ctx, { includeArchived: true }),
    categoryOptions(ctx, "expense"),
    getDb()
      .select({ first: min(budgetLimits.fromMonth) })
      .from(budgetLimits)
      .where(userScoped(ctx).owns(budgetLimits)),
  ]);

  const byScope = new Map<string, { scope: BudgetScope; versions: LimitVersion[] }>();
  for (const version of versions) {
    const key = scopeKey(version);
    const entry = byScope.get(key) ?? { scope: version, versions: [] };
    entry.versions.push(version);
    byScope.set(key, entry);
  }
  const limits = [...byScope.values()].flatMap(({ scope, versions: list }) => {
    const limit = limitFor(list, month);
    return limit === null
      ? []
      : [{ categoryId: scope.categoryId, accountId: scope.accountId, limitCents: limit }];
  });
  const result = budgetRows(
    tree.filter((category) => category.type === "expense"),
    accounts,
    limits,
    spending,
  );

  return {
    month,
    ...result,
    categories: options,
    accounts: accounts
      .filter((account) => account.state !== "archived")
      .map((account) => ({ id: account.id, name: account.name })),
    firstMonth: first[0]?.first ?? null,
  };
}
