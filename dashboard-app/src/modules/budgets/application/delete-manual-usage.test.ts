import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addManualUsage } from "./add-manual-usage";
import { deleteManualUsage } from "./delete-manual-usage";
import { NotFoundError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";

describe("deleteManualUsage", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const usage = await addManualUsage(h.deps)(testPrincipal(), budget.id, { amount: "10.00", occurredAt: "2026-02-01" });
    await expect(deleteManualUsage(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, usage.id)).rejects.toThrow(
      PermissionDeniedError,
    );
  });

  it("raises NotFoundError for a missing usage", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(deleteManualUsage(h.deps)(testPrincipal(), budget.id, "missing")).rejects.toThrow(NotFoundError);
  });

  it("raises NotFoundError for a scope-matched row — it is not a manual row", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await h.deps.usages.replaceScopeMatched(budget.id, [{ transactionId: "tx-1", amount: "20.00", occurredAt: "2026-02-01" }]);
    const [scopeRow] = await h.deps.usages.listForBudget(budget.id);
    await expect(deleteManualUsage(h.deps)(testPrincipal(), budget.id, scopeRow!.id)).rejects.toThrow(NotFoundError);
    expect(await h.deps.usages.listForBudget(budget.id)).toHaveLength(1);
  });

  it("deletes a manual usage and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const usage = await addManualUsage(h.deps)(testPrincipal(), budget.id, { amount: "10.00", occurredAt: "2026-02-01" });
    await deleteManualUsage(h.deps)(testPrincipal(), budget.id, usage.id);
    expect(await h.deps.usages.listForBudget(budget.id)).toEqual([]);

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.usage_added" }),
      expect.objectContaining({ action: "budgets.usage_deleted", entityId: usage.id }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events.map((e) => e.kind).sort()).toEqual(["usage_added", "usage_deleted"]);
  });
});
