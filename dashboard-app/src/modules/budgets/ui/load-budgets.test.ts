import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { budgetHarness, seedBudget } from "../application/test-support";
import type { BudgetSummary } from "../application/list-budgets";
import { activeBudgetsCard, loadBudgetDetail, loadBudgets } from "./load-budgets";
import { setBudgetDepsFactoryForTests, setPrincipalForTests } from "./run";

function summary(overrides: Partial<{ status: "active" | "archived"; currency: string; remaining: string }> = {}): Pick<
  BudgetSummary,
  "budget" | "figures"
> {
  return {
    budget: {
      id: crypto.randomUUID(),
      userId: "user-1",
      name: "Groceries",
      description: null,
      currency: overrides.currency ?? "EUR",
      status: overrides.status ?? "active",
      periodKind: "monthly",
      startDate: "2026-01-01",
      endDate: null,
      goalAmount: null,
      labels: [],
      archivedAt: null,
      version: 1,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    },
    figures: {
      initial: "0.00",
      allocated: "0.00",
      used: "0.00",
      remaining: overrides.remaining ?? "100.00",
      goalProgress: null,
    },
  };
}

describe("activeBudgetsCard", () => {
  it("reports an empty state — no fabricated zero — when there are no active budgets", () => {
    expect(activeBudgetsCard([])).toEqual({ count: 0, remaining: null });
    expect(activeBudgetsCard([summary({ status: "archived" })])).toEqual({ count: 0, remaining: null });
  });

  it("counts only active budgets and sums their remaining", () => {
    const result = activeBudgetsCard([
      summary({ remaining: "100.00" }),
      summary({ remaining: "-25.50" }),
      summary({ status: "archived", remaining: "9999.00" }),
    ]);
    expect(result).toEqual({ count: 2, remaining: "74.50" });
  });

  it("withholds the sum instead of converting across a currency mismatch", () => {
    const result = activeBudgetsCard([
      summary({ currency: "EUR", remaining: "100.00" }),
      summary({ currency: "USD", remaining: "50.00" }),
    ]);
    expect(result).toEqual({ count: 2, remaining: null });
  });
});

describe("loadBudgets", () => {
  it("includes archived budgets, so the list page can show status per row", async () => {
    const h = budgetHarness();
    const active = await seedBudget(h.deps, { name: "Active" });
    const archived = await seedBudget(h.deps, { name: "Archived" });
    await h.deps.budgets.update(testPrincipal().userId, archived.id, archived.version, {
      status: "archived",
      archivedAt: h.deps.clock.now(),
    });

    setBudgetDepsFactoryForTests(() => h.deps);
    setPrincipalForTests(testPrincipal());
    const rows = await loadBudgets();
    expect(rows.map((r) => r.budget.id).sort()).toEqual([active.id, archived.id].sort());
    setBudgetDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});

describe("loadBudgetDetail", () => {
  it("returns null for an id that does not exist, without throwing", async () => {
    const h = budgetHarness();
    setBudgetDepsFactoryForTests(() => h.deps);
    setPrincipalForTests(testPrincipal());
    expect(await loadBudgetDetail("00000000-0000-7000-8000-000000000099")).toBeNull();
    setBudgetDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("re-throws a failure that is not NotFoundError, rather than reporting it as a 404", async () => {
    const h = budgetHarness();
    h.deps.budgets.get = () => {
      throw new Error("boom");
    };
    setBudgetDepsFactoryForTests(() => h.deps);
    setPrincipalForTests(testPrincipal());
    await expect(loadBudgetDetail("00000000-0000-7000-8000-000000000099")).rejects.toThrow("boom");
    setBudgetDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });

  it("returns the detail for a budget that exists", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await h.deps.versions.add({ budgetId: budget.id, initialAmount: "500.00", effectiveFrom: budget.startDate, reason: null, actorUserId: null });
    setBudgetDepsFactoryForTests(() => h.deps);
    setPrincipalForTests(testPrincipal());
    const detail = await loadBudgetDetail(budget.id);
    expect(detail?.budget.id).toBe(budget.id);
    expect(detail?.figures.initial).toBe("500.00");
    setBudgetDepsFactoryForTests(null);
    setPrincipalForTests(null);
  });
});
