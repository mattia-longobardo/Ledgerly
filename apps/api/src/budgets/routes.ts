// Budgets (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the domain's.
// The static paths are served before `/budgets/{budget}`: Hono tries the routes in their order.
import type { Hono } from "hono";
import { BUDGETS, BUDGETS_ROUTES, OVERVIEW_BUDGETS, type RouteContract } from "@ledgerly/api-contract";
import {
  BudgetError,
  budgetDetail,
  budgetsView,
  closestToLimit,
  parseBudgetSlug,
  saveAlerts,
  setLimit,
  stopLimit,
  type BudgetScope,
} from "@ledgerly/domain/budgets";
import { parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { budgetLine, budgetRow, money, monthOf } from "./dto";

const { budgets } = BUDGETS;

/** The scope a slug names; the contract has already refused anything that is not one. */
function scopeOf(slug: string): BudgetScope {
  const scope = parseBudgetSlug(slug);
  if (!scope) throw new ApiRefusal("invalid");
  return scope;
}

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof BudgetError)
      throw new ApiRefusal(error.code === "not_found" ? "not_found" : "invalid");
    throw error;
  }
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, budgets.listBudgets, async ({ ctx, query }) => {
    const view = await budgetsView(ctx, monthOf(ctx, query.month));
    return {
      month: view.month,
      budgets: view.rows.map(budgetRow),
      totals: { limit: money(view.totals.limitCents), spent: money(view.totals.spentCents) },
      unbudgeted: money(view.unbudgetedCents),
    };
  });
  serve(app, guard, budgets.getBudgetsView, async ({ ctx, query }) => {
    const view = await budgetsView(ctx, monthOf(ctx, query.month));
    const { limitCents, spentCents } = view.totals;
    return {
      month: view.month,
      budgets: view.rows.map(budgetLine),
      totals: {
        limit: money(limitCents),
        spent: money(spentCents),
        remaining: money(limitCents - spentCents),
      },
      unbudgeted: money(view.unbudgetedCents),
      toCategorise: { count: view.toCategorise.count, amount: money(view.toCategorise.cents) },
      categories: view.categories,
      accounts: view.accounts,
      firstMonth: view.firstMonth,
    };
  });
  serve(app, guard, budgets.getBudgetsOverview, async ({ ctx, query }) => {
    const view = await budgetsView(ctx, monthOf(ctx, query.month));
    return { month: view.month, budgets: closestToLimit(view.rows, OVERVIEW_BUDGETS).map(budgetLine) };
  });
  serve(app, guard, budgets.getBudget, async ({ ctx, params, query }) => {
    const detail = await budgetDetail(ctx, scopeOf(params.budget), monthOf(ctx, query.month));
    if (!detail) throw new ApiRefusal("not_found");
    return {
      budget: budgetLine(detail.row),
      history: detail.history.map((past) => ({
        month: past.month,
        limit: past.limitCents === null ? null : money(past.limitCents),
        spent: money(past.spentCents),
      })),
      alerts: detail.alerts,
    };
  });
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, budgets.setBudgetLimit, async ({ ctx, params, body }) => {
    let cents;
    try {
      cents = parseCents(body.amount);
    } catch {
      throw new ApiRefusal("invalid", "amount");
    }
    await refusing(setLimit(ctx, { ...scopeOf(params.budget), month: monthOf(ctx, body.month), cents }));
  });
  serve(app, guard, budgets.stopBudget, async ({ ctx, params, body }) => {
    await refusing(stopLimit(ctx, { ...scopeOf(params.budget), month: monthOf(ctx, body.month) }));
  });
  serve(app, guard, budgets.saveBudgetAlerts, async ({ ctx, params, body }) =>
    refusing(saveAlerts(ctx, { ...scopeOf(params.budget), ...body })),
  );
}

/** Every route of budgets, in the order that keeps the static paths before `{budget}`. */
export function serveBudgets(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveWrites(app, guard);
  return BUDGETS_ROUTES;
}
