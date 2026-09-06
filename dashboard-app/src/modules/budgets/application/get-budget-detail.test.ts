import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { addAllocation } from "./add-allocation";
import { NotFoundError } from "./errors";
import { getBudgetDetail } from "./get-budget-detail";
import { budgetHarness, seedBudget } from "./test-support";

describe("getBudgetDetail", () => {
  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(getBudgetDetail(h.deps)(testPrincipal(), "missing")).rejects.toThrow(NotFoundError);
  });

  it("runs refreshUsages first, so a scope-matched expense already shows up in usages", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    await h.deps.scopes.replace(budget.id, [{ kind: "category", refId: "cat-1" }]);
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-20.00", occurredAt: "2026-02-01" },
    ]);
    const detail = await getBudgetDetail(h.deps)(testPrincipal(), budget.id);
    expect(detail.usages).toEqual([expect.objectContaining({ transactionId: "tx-1", amount: "20.00" })]);
  });

  it("computes availableInSource across all of the user's budgets against the same source, and resolves the source label", async () => {
    const h = budgetHarness();
    h.fundOwners.add("fund-1");
    h.fundNames.set("fund-1", "Emergency Fund");
    h.balances.set("fund:fund-1", "100.00");

    const budgetA = await seedBudget(h.deps, { name: "A", startDate: "2026-01-01" });
    const budgetB = await seedBudget(h.deps, { name: "B", startDate: "2026-01-01" });
    await h.deps.versions.add({ budgetId: budgetA.id, initialAmount: "100.00", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });
    await addAllocation(h.deps)(testPrincipal(), budgetA.id, {
      sourceKind: "fund",
      sourceId: "fund-1",
      amount: "40.00",
      recurrence: "once",
      effectiveFrom: "2026-01-01",
    });
    await addAllocation(h.deps)(testPrincipal(), budgetB.id, {
      sourceKind: "fund",
      sourceId: "fund-1",
      amount: "10.00",
      recurrence: "once",
      effectiveFrom: "2026-01-01",
    });

    const detail = await getBudgetDetail(h.deps)(testPrincipal(), budgetA.id);
    expect(detail.allocations).toHaveLength(1);
    expect(detail.allocations[0]).toMatchObject({ sourceLabel: "Emergency Fund", availableInSource: "50.00" });

    expect(detail.asOf).toBe("2026-09-06");
    expect(detail.figures.initial).toBe("100.00");
    expect(detail.figures.allocated).toBe("40.00");
    expect(detail.series).toHaveLength(9);
    expect(detail.series[0]).toEqual({ month: "2026-01-01", remaining: "140.00" });
    expect(detail.series.at(-1)).toEqual({ month: "2026-09-01", remaining: "140.00" });
  });

  it("leaves sourceLabel and availableInSource null for a sourceKind 'none' allocation", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    await addAllocation(h.deps)(testPrincipal(), budget.id, {
      sourceKind: "none",
      amount: "10.00",
      recurrence: "once",
      effectiveFrom: "2026-01-01",
    });
    const detail = await getBudgetDetail(h.deps)(testPrincipal(), budget.id);
    expect(detail.allocations[0]).toMatchObject({ sourceLabel: null, availableInSource: null });
  });
});
