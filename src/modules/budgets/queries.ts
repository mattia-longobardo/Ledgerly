import "server-only";
import { and, asc, lte, min } from "drizzle-orm";
import { listAccounts } from "@/modules/accounts/queries";
import { monthSpending } from "@/modules/transactions/queries";
import { categoryOptions, listCategories } from "@/modules/transactions/taxonomy";
import type { Ctx } from "@/platform/context";
import { addMonths, type MonthKey } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  type AlertSettings,
  type BudgetRow,
  budgetRows,
  type BudgetScope,
  DEFAULT_ALERT_SETTINGS,
  type LimitVersion,
  limitFor,
  scopeKey,
} from "./rules";
import { budgetAlerts, budgetLimits } from "./schema";

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

/** Every alert setting the user saved, by {@link scopeKey}; a budget missing here has the defaults. */
export async function alertSettings(ctx: Pick<Ctx, "userId">): Promise<Map<string, AlertSettings>> {
  const rows = await getDb()
    .select({
      categoryId: budgetAlerts.categoryId,
      accountId: budgetAlerts.accountId,
      enabled: budgetAlerts.enabled,
      thresholds: budgetAlerts.thresholds,
    })
    .from(budgetAlerts)
    .where(userScoped(ctx).owns(budgetAlerts))
    .orderBy(asc(budgetAlerts.id));
  return new Map(
    rows.map((row) => [scopeKey(row), { enabled: row.enabled, thresholds: [...row.thresholds] }]),
  );
}

/** One month of a budget's history: the limit in force (`null` with none) and what was spent. */
export interface BudgetMonth {
  month: MonthKey;
  limitCents: Cents | null;
  spentCents: Cents;
}

export interface BudgetDetail {
  /** This month's row, as the Budgets table shows it. */
  row: BudgetRow;
  /** The months before it, newest first, `HISTORY_MONTHS` of them. */
  history: BudgetMonth[];
  alerts: AlertSettings;
}

export const HISTORY_MONTHS = 6;

/**
 * One budget's own page: `month`'s row, the months before it and when it emails. `null` when the
 * scope has no limit in `month` — a budget stopped or never set has no page to show.
 */
export async function budgetDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  scope: BudgetScope,
  month: MonthKey,
): Promise<BudgetDetail | null> {
  const view = await budgetsView(ctx, month);
  const key = scopeKey(scope);
  const row = view.rows.find((one) => one.key === key);
  if (!row) return null;

  const months = Array.from({ length: HISTORY_MONTHS }, (_, index) => addMonths(month, -(index + 1)));
  const [versions, tree, accounts, settings, ...spending] = await Promise.all([
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
      .orderBy(asc(budgetLimits.fromMonth), asc(budgetLimits.id)),
    listCategories(ctx, { includeArchived: true }),
    listAccounts(ctx, { includeArchived: true }),
    alertSettings(ctx),
    ...months.map((one) => monthSpending(ctx, one)),
  ]);
  const own = versions.filter((version) => scopeKey(version) === key);
  const expense = tree.filter((category) => category.type === "expense");
  const history = months.map((one, index) => {
    const limitCents = limitFor(own, one);
    // The spent of a month with no limit is still the scope's spending: the row is computed
    // against a stand-in limit of one cent and only its `spentCents` is kept.
    const [computed] = budgetRows(
      expense,
      accounts,
      [{ ...scope, limitCents: limitCents ?? 1n }],
      spending[index],
    ).rows;
    return { month: one, limitCents, spentCents: computed.spentCents };
  });

  return {
    row,
    history,
    alerts: settings.get(key) ?? {
      ...DEFAULT_ALERT_SETTINGS,
      thresholds: [...DEFAULT_ALERT_SETTINGS.thresholds],
    },
  };
}
