import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { listBudgets } from "./list-budgets";
import { budgetHarness, seedBudget } from "./test-support";

describe("listBudgets", () => {
  it("lists active budgets by default and includes archived on request", async () => {
    const h = budgetHarness();
    const active = await seedBudget(h.deps, { name: "Active" });
    const toArchive = await seedBudget(h.deps, { name: "Archived" });
    await h.deps.budgets.update(testPrincipal().userId, toArchive.id, toArchive.version, {
      status: "archived",
      archivedAt: h.deps.clock.now(),
    });

    const defaultList = await listBudgets(h.deps)(testPrincipal());
    expect(defaultList.map((s) => s.budget.id)).toEqual([active.id]);

    const withArchived = await listBudgets(h.deps)(testPrincipal(), { includeArchived: true });
    expect(withArchived.map((s) => s.budget.id).sort()).toEqual([active.id, toArchive.id].sort());
  });

  it("computes asOf as min(endDate ?? today, today) and figures for each budget", async () => {
    const h = budgetHarness();
    const open = await seedBudget(h.deps, { name: "Open" });
    const closed = await seedBudget(h.deps, { name: "Closed", endDate: "2026-06-30" });
    await h.deps.versions.add({ budgetId: open.id, initialAmount: "100.00", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });
    await h.deps.versions.add({ budgetId: closed.id, initialAmount: "50.00", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });

    const summaries = await listBudgets(h.deps)(testPrincipal());
    const openSummary = summaries.find((s) => s.budget.id === open.id);
    const closedSummary = summaries.find((s) => s.budget.id === closed.id);
    expect(openSummary?.asOf).toBe("2026-09-06");
    expect(openSummary?.figures.initial).toBe("100.00");
    expect(closedSummary?.asOf).toBe("2026-06-30");
    expect(closedSummary?.figures.initial).toBe("50.00");
  });

  it("refreshes scope-matched usages first, so the list cannot show pre-sync figures the detail page has already moved past", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    await h.deps.versions.add({ budgetId: budget.id, initialAmount: "100.00", effectiveFrom: "2026-01-01", reason: null, actorUserId: null });
    await h.deps.scopes.replace(budget.id, [{ kind: "category", refId: "cat-1" }]);
    // Arrives after the budget was created, the way a provider sync brings in
    // expenses nothing on the list page would otherwise ever match.
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-30.00", occurredAt: "2026-02-01" },
    ]);

    const [summary] = await listBudgets(h.deps)(testPrincipal());
    expect(summary?.figures.used).toBe("30.00");
    expect(summary?.figures.remaining).toBe("70.00");
    expect((await h.deps.usages.listForBudget(budget.id)).map((u) => u.transactionId)).toEqual(["tx-1"]);
  });

  it("refreshes every budget in the list, not only the first", async () => {
    const h = budgetHarness();
    const first = await seedBudget(h.deps, { name: "First", startDate: "2026-01-01" });
    const second = await seedBudget(h.deps, { name: "Second", startDate: "2026-01-01" });
    await h.deps.scopes.replace(first.id, [{ kind: "category", refId: "cat-1" }]);
    await h.deps.scopes.replace(second.id, [{ kind: "category", refId: "cat-2" }]);
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-10.00", occurredAt: "2026-02-01" },
      { id: "tx-2", accountId: "account-1", categoryId: "cat-2", labelIds: [], type: "expense", amount: "-25.00", occurredAt: "2026-02-02" },
    ]);

    const summaries = await listBudgets(h.deps)(testPrincipal());
    expect(summaries.find((s) => s.budget.id === first.id)?.figures.used).toBe("10.00");
    expect(summaries.find((s) => s.budget.id === second.id)?.figures.used).toBe("25.00");
  });
});
