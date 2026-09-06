import { monthKeyOf, monthRange, romeDate } from "@/lib/time";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { availableInSource, figures, type BudgetFigures } from "../domain/figures";
import { NotFoundError } from "./errors";
import type { BudgetSummary } from "./list-budgets";
import type { Allocation, AmountVersion, BudgetEvent, Scope, Usage, UseCaseDeps } from "./ports";
import { refreshUsages } from "./refresh-usages";

export interface AllocationView extends Allocation {
  sourceLabel: string | null;
  availableInSource: string | null;
}

export interface BudgetDetail extends BudgetSummary {
  versions: AmountVersion[];
  allocations: AllocationView[];
  scopes: Scope[];
  usages: Usage[];
  events: BudgetEvent[];
  series: { month: string; remaining: string }[];
}

function asOfFor(endDate: string | null, today: string): string {
  return endDate !== null && endDate < today ? endDate : today;
}

/** Last calendar day of a "YYYY-MM-01" month key, as "YYYY-MM-DD". */
function lastDayOfMonth(monthStart: string): string {
  const [year, month] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/**
 * `availableInSource` per sourced allocation is `balances.latestBalance(...)
 * − allocatedThrough(allocations.listAgainstSource(userId, kind, id), asOf)`
 * — summed across all the user's budgets against that source, not just this
 * one, since two budgets can share the same fund or account.
 */
export function getBudgetDetail(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<BudgetDetail> => {
    assertPermission(principal, "budgets.read");
    const budget = await deps.budgets.get(principal.userId, id);
    if (!budget) throw new NotFoundError();

    await refreshUsages(deps)(principal, id);

    const [versions, allocations, scopes, usages, events] = await Promise.all([
      deps.versions.listForBudget(id),
      deps.allocations.listForBudget(id),
      deps.scopes.listForBudget(id),
      deps.usages.listForBudget(id),
      deps.events.listForBudget(id),
    ]);

    const today = romeDate(deps.clock.now());
    const asOf = asOfFor(budget.endDate, today);
    const figuresNow: BudgetFigures = figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, asOf);

    const allocationViews = await Promise.all(
      allocations.map(async (allocation) => {
        if (allocation.sourceKind === "none" || allocation.sourceId === null) {
          return { ...allocation, sourceLabel: null, availableInSource: null };
        }
        const sourceId = allocation.sourceId;
        const [sourceLabel, balance, against] = await Promise.all([
          allocation.sourceKind === "fund"
            ? (deps.labels?.fundName(principal.userId, sourceId) ?? Promise.resolve(null))
            : (deps.labels?.accountName(principal.userId, sourceId) ?? Promise.resolve(null)),
          deps.balances.latestBalance(principal.userId, { kind: allocation.sourceKind, id: sourceId }),
          deps.allocations.listAgainstSource(principal.userId, allocation.sourceKind, sourceId),
        ]);
        return { ...allocation, sourceLabel, availableInSource: availableInSource(balance, against, asOf) };
      }),
    );

    const series = monthRange(monthKeyOf(budget.startDate), monthKeyOf(asOf)).map((month) => ({
      month,
      remaining: figures({ versions, allocations, usages, goalAmount: budget.goalAmount }, lastDayOfMonth(month)).remaining,
    }));

    return { budget, figures: figuresNow, asOf, versions, allocations: allocationViews, scopes, usages, events, series };
  };
}
