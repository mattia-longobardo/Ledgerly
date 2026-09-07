import { describe, expect, it } from "vitest";
import { testPrincipal } from "@/test/principal";
import { NotFoundError } from "./errors";
import { refreshUsages } from "./refresh-usages";
import { budgetHarness, seedBudget } from "./test-support";

describe("refreshUsages", () => {
  it("asks the scope source only for the budget's own currency, and never counts another currency's expense", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01", currency: "EUR" });
    await h.deps.scopes.replace(budget.id, [{ kind: "category", refId: "cat-1" }]);
    h.setExpenses([
      { id: "tx-eur", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-20.00", occurredAt: "2026-02-01", currency: "EUR" },
      // Matches the same scope, but counting it into a EUR budget at face
      // value would silently mix currencies into `used`.
      { id: "tx-usd", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-99.00", occurredAt: "2026-02-02", currency: "USD" },
    ]);

    const result = await refreshUsages(h.deps)(testPrincipal(), budget.id);
    expect(result).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    expect((await h.deps.usages.listForBudget(budget.id)).map((u) => u.transactionId)).toEqual(["tx-eur"]);
    expect(h.listExpensesCalls).toEqual([{ from: "2026-01-01", to: "2026-09-06", currency: "EUR" }]);
  });

  it("allows a viewer — it is a read-side refresh", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(refreshUsages(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id)).resolves.toEqual({
      inserted: 0,
      updated: 0,
      deleted: 0,
    });
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(refreshUsages(h.deps)(testPrincipal(), "missing")).rejects.toThrow(NotFoundError);
  });

  it("a budget with no scopes matches nothing, even when matching-looking transactions exist", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-20.00", occurredAt: "2026-02-01" },
    ]);
    const result = await refreshUsages(h.deps)(testPrincipal(), budget.id);
    expect(result).toEqual({ inserted: 0, updated: 0, deleted: 0 });
    expect(await h.deps.usages.listForBudget(budget.id)).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it("inserts a scope-matched expense, ignores an income in the same category, keeps a manual usage, and deletes the usage once the scope is removed", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    await h.deps.scopes.replace(budget.id, [{ kind: "category", refId: "cat-1" }]);
    const manual = await h.deps.usages.create({
      budgetId: budget.id,
      transactionId: null,
      amount: "5.00",
      occurredAt: "2026-01-15",
      matchedBy: "manual",
      note: "cash",
    });
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-20.00", occurredAt: "2026-02-01" },
      { id: "tx-2", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "income", amount: "15.00", occurredAt: "2026-02-05" },
    ]);

    const first = await refreshUsages(h.deps)(testPrincipal(), budget.id);
    expect(first).toEqual({ inserted: 1, updated: 0, deleted: 0 });
    const afterFirst = await h.deps.usages.listForBudget(budget.id);
    expect(afterFirst).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: manual.id, matchedBy: "manual" }),
        expect.objectContaining({ transactionId: "tx-1", amount: "20.00", matchedBy: "scope" }),
      ]),
    );
    expect(afterFirst).toHaveLength(2);
    expect(h.audits).toEqual([expect.objectContaining({ action: "budgets.usages_refreshed" })]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([expect.objectContaining({ kind: "usages_refreshed" })]);

    await h.deps.scopes.replace(budget.id, []);
    const second = await refreshUsages(h.deps)(testPrincipal(), budget.id);
    expect(second).toEqual({ inserted: 0, updated: 0, deleted: 1 });
    const afterSecond = await h.deps.usages.listForBudget(budget.id);
    expect(afterSecond).toEqual([expect.objectContaining({ id: manual.id, matchedBy: "manual" })]);
  });
});
