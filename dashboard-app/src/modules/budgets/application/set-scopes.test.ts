import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { NotFoundError } from "./errors";
import { setScopes } from "./set-scopes";
import { budgetHarness, seedBudget } from "./test-support";

describe("setScopes", () => {
  it("collapses a repeated {kind, refId} before it reaches the repository", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const scopes = await setScopes(h.deps)(testPrincipal(), budget.id, [
      { kind: "category", refId: "cat-1" },
      { kind: "label", refId: "label-1" },
      { kind: "category", refId: "cat-1" },
    ]);
    expect(scopes.map((s) => `${s.kind}:${s.refId}`)).toEqual(["category:cat-1", "label:label-1"]);
    expect(await h.deps.scopes.listForBudget(budget.id)).toHaveLength(2);
  });

  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(setScopes(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, [])).rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(setScopes(h.deps)(testPrincipal(), "missing", [])).rejects.toThrow(NotFoundError);
  });

  it("replaces scopes, refreshes usages, and audits and logs both events", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01" });
    h.setExpenses([
      { id: "tx-1", accountId: "account-1", categoryId: "cat-1", labelIds: [], type: "expense", amount: "-20.00", occurredAt: "2026-02-01" },
    ]);

    const scopes = await setScopes(h.deps)(testPrincipal(), budget.id, [{ kind: "category", refId: "cat-1" }]);
    expect(scopes).toEqual([expect.objectContaining({ kind: "category", refId: "cat-1" })]);

    const usages = await h.deps.usages.listForBudget(budget.id);
    expect(usages).toEqual([expect.objectContaining({ transactionId: "tx-1", amount: "20.00", matchedBy: "scope" })]);

    expect(h.audits.map((a) => a.action).sort()).toEqual(["budgets.scopes_set", "budgets.usages_refreshed"]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events.map((e) => e.kind).sort()).toEqual(["scopes_set", "usages_refreshed"]);
  });
});
