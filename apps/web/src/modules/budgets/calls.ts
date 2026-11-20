// The calls of Budgets to `/api/v1` (rewrite plan R3): each keeps the answer of the Server Action it
// replaces, so the screens read one shape. The limit is read in the person's number format here, on
// the client, and goes on the wire as a decimal string (`amountInput`).
import { budgets } from "@ledgerly/api-contract/budgets";
import { categories as categoryRoutes, profile } from "@ledgerly/api-contract/settings";
import { ApiError, call } from "@ledgerly/api-client";
import { centsToDecimal } from "@ledgerly/format/cents";
import { numberStyle, parseAmount } from "@ledgerly/format/format";
import { invalidate, read } from "@ledgerly/ui/data";

type BudgetResult = { ok: true } | { ok: false; error: string };

/** A budget's scope: a category, an account or both; `null` is «all». */
interface BudgetScope {
  categoryId: string | null;
  accountId: string | null;
}

/** A budget's address on the wire: `<category|all>_<account|all>`, as its page's URL. */
const budgetSlugOf = (scope: BudgetScope) => `${scope.categoryId || "all"}_${scope.accountId || "all"}`;

/** What a budget's write changes: the Budgets page, Overview's card, a budget's and a category's page. */
function changed(): void {
  invalidate(
    budgets.listBudgets,
    budgets.getBudgetsView,
    budgets.getBudgetsOverview,
    budgets.getBudget,
    categoryRoutes.getCategorySummary,
  );
}

/** A refusal of the use case as its code (`invalid`, `not_found`); a failure of the server throws. */
async function writing(work: () => Promise<unknown>): Promise<BudgetResult> {
  try {
    await work();
    changed();
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) return { ok: false, error: error.code };
    throw error;
  }
}

/** The limit typed in the person's format, as the decimal of the contract; null when it is not one. */
async function decimalOf(typed: string): Promise<string | null> {
  const style = numberStyle(await read(profile.getPreferences, {}));
  try {
    return centsToDecimal(parseAmount(typed, style));
  } catch {
    return null;
  }
}

/** Sets the limit of a scope from `month` (`YYYY-MM-01`) onwards. */
export async function setBudgetLimit(
  scope: BudgetScope,
  month: string,
  typed: string,
): Promise<BudgetResult> {
  const amount = await decimalOf(typed);
  if (amount === null) return { ok: false, error: "invalid" };
  return writing(() =>
    call(budgets.setBudgetLimit, { params: { budget: budgetSlugOf(scope) }, body: { month, amount } }),
  );
}

/** Takes the budget away from `month` onwards. */
export function stopBudget(scope: BudgetScope, month: string): Promise<BudgetResult> {
  return writing(() =>
    call(budgets.stopBudget, { params: { budget: budgetSlugOf(scope) }, body: { month } }),
  );
}

/** When a budget emails its owner: on or off, and the percentages of its limit that do. */
export function saveBudgetAlerts(
  scope: BudgetScope,
  settings: { enabled: boolean; thresholds: number[] },
): Promise<BudgetResult> {
  return writing(() =>
    call(budgets.saveBudgetAlerts, { params: { budget: budgetSlugOf(scope) }, body: settings }),
  );
}
