import { and, asc, lte, min } from "drizzle-orm";
import { accountOptions, listAccounts } from "../accounts";
import { categoryOptions, listCategories, monthSpending } from "../transactions";
import type { Ctx } from "../../platform/context";
import { addMonths, type MonthKey } from "../../shared/dates";
import { getDb } from "../../platform/db/client";
import { userScoped } from "../../platform/db/scope";
import type { Cents } from "../../shared/money";
import {
  type AlertSettings,
  type BudgetRow,
  budgetRows,
  type BudgetScope,
  DEFAULT_ALERT_SETTINGS,
  familiesOf,
  type LimitVersion,
  limitFor,
  scopeKey,
  spentFor,
} from "./rules";
import { budgetAlerts, budgetLimits } from "./schema";

interface BudgetOption {
  id: string;
  name: string;
  color: string;
  depth: 0 | 1;
}

interface BudgetsView {
  month: MonthKey;
  rows: BudgetRow[];
  totals: { limitCents: Cents; spentCents: Cents };
  unbudgetedCents: Cents;
  /**
   * The spending of the month that waits for a category (rewrite plan N3): in no category budget
   * until a person files it. How many movements, and their sum.
   */
  toCategorise: { count: number; cents: Cents };
  /** What "Add budget" offers: the open spending categories and the open accounts. */
  categories: BudgetOption[];
  accounts: { id: string; name: string }[];
  /** The month of the first limit ever set, `null` with none: where the stepper stops going back. */
  firstMonth: MonthKey | null;
}

/** Every scope with a limit set on or before `month`, and its versions (audit BUD-3: one query). */
async function loadLimits(
  ctx: Pick<Ctx, "userId">,
  month: MonthKey,
): Promise<Map<string, { scope: BudgetScope; versions: LimitVersion[] }>> {
  const versions = await getDb()
    .select({
      categoryId: budgetLimits.categoryId,
      accountId: budgetLimits.accountId,
      fromMonth: budgetLimits.fromMonth,
      amountCents: budgetLimits.amountCents,
      stopped: budgetLimits.stopped,
    })
    .from(budgetLimits)
    .where(and(userScoped(ctx).owns(budgetLimits), lte(budgetLimits.fromMonth, month)))
    .orderBy(asc(budgetLimits.categoryId), asc(budgetLimits.accountId), asc(budgetLimits.fromMonth));
  const byScope = new Map<string, { scope: BudgetScope; versions: LimitVersion[] }>();
  for (const version of versions) {
    const key = scopeKey(version);
    const entry = byScope.get(key) ?? {
      scope: { categoryId: version.categoryId, accountId: version.accountId },
      versions: [],
    };
    entry.versions.push(version);
    byScope.set(key, entry);
  }
  return byScope;
}

/** The limit each scope has in `month`; a scope stopped or not yet begun has none. */
function limitsIn(
  byScope: ReadonlyMap<string, { scope: BudgetScope; versions: LimitVersion[] }>,
  month: MonthKey,
): (BudgetScope & { limitCents: Cents })[] {
  return [...byScope.values()].flatMap(({ scope, versions }) => {
    const limit = limitFor(versions, month);
    return limit === null ? [] : [{ ...scope, limitCents: limit }];
  });
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
  const [byScope, spending, tree, accounts, options, first] = await Promise.all([
    loadLimits(ctx, month),
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

  const result = budgetRows(
    tree.filter((category) => category.type === "expense"),
    accounts,
    limitsIn(byScope, month),
    spending,
  );

  return {
    month,
    ...result,
    toCategorise: {
      count: spending.reduce((sum, row) => sum + row.waiting, 0),
      cents: spending.reduce((sum, row) => sum + row.waitingCents, 0n),
    },
    categories: options,
    accounts: accountOptions(accounts),
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
interface BudgetMonth {
  month: MonthKey;
  limitCents: Cents | null;
  spentCents: Cents;
}

interface BudgetDetail {
  /** This month's row, as the Budgets table shows it. */
  row: BudgetRow;
  /** The months before it, newest first, `HISTORY_MONTHS` of them. */
  history: BudgetMonth[];
  alerts: AlertSettings;
}

const HISTORY_MONTHS = 6;

/**
 * One budget's own page: `month`'s row, the months before it and when it emails. `null` when the
 * scope has no limit in `month` — a budget stopped or never set has no page to show.
 */
export async function budgetDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  scope: BudgetScope,
  month: MonthKey,
): Promise<BudgetDetail | null> {
  const key = scopeKey(scope);
  const months = Array.from({ length: HISTORY_MONTHS }, (_unused, index) => addMonths(month, -(index + 1)));
  const [byScope, tree, accounts, settings, current, ...spending] = await Promise.all([
    loadLimits(ctx, month),
    listCategories(ctx, { includeArchived: true }),
    listAccounts(ctx, { includeArchived: true }),
    alertSettings(ctx),
    monthSpending(ctx, month),
    ...months.map((one) => monthSpending(ctx, one)),
  ]);
  const expense = tree.filter((category) => category.type === "expense");
  // The row as the Budgets table shows it: its depth depends on the other budgets of the month.
  const row = budgetRows(expense, accounts, limitsIn(byScope, month), current).rows.find(
    (one) => one.key === key,
  );
  if (!row) return null;

  const own = byScope.get(key)?.versions ?? [];
  const families = familiesOf([scope], expense);
  const history = months.map((one, index) => ({
    month: one,
    limitCents: limitFor(own, one),
    spentCents: spentFor(scope, spending[index], families),
  }));

  return {
    row,
    history,
    alerts: settings.get(key) ?? {
      ...DEFAULT_ALERT_SETTINGS,
      thresholds: [...DEFAULT_ALERT_SETTINGS.thresholds],
    },
  };
}
