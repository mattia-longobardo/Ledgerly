import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addAllocation } from "./add-allocation";
import { endAllocation } from "./end-allocation";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";

describe("endAllocation", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const allocation = await addAllocation(h.deps)(testPrincipal(), budget.id, {
      sourceKind: "none",
      amount: "50.00",
      recurrence: "monthly",
      effectiveFrom: "2026-01-01",
    });
    await expect(
      endAllocation(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, allocation.id, allocation.version, "2026-03-31"),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing allocation", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(endAllocation(h.deps)(testPrincipal(), budget.id, "missing", 1, "2026-03-31")).rejects.toThrow(NotFoundError);
  });

  it("rejects an end date before the allocation's start", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const allocation = await addAllocation(h.deps)(testPrincipal(), budget.id, {
      sourceKind: "none",
      amount: "50.00",
      recurrence: "monthly",
      effectiveFrom: "2026-03-01",
    });
    await expect(
      endAllocation(h.deps)(testPrincipal(), budget.id, allocation.id, allocation.version, "2026-01-01"),
    ).rejects.toThrow(InvalidInputError);
  });

  it("raises VersionMismatchError on a stale version", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const allocation = await addAllocation(h.deps)(testPrincipal(), budget.id, {
      sourceKind: "none",
      amount: "50.00",
      recurrence: "monthly",
      effectiveFrom: "2026-01-01",
    });
    await expect(
      endAllocation(h.deps)(testPrincipal(), budget.id, allocation.id, allocation.version + 1, "2026-03-31"),
    ).rejects.toThrow(VersionMismatchError);
  });

  it("sets effectiveTo and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const allocation = await addAllocation(h.deps)(testPrincipal(), budget.id, {
      sourceKind: "none",
      amount: "50.00",
      recurrence: "monthly",
      effectiveFrom: "2026-01-01",
    });
    const ended = await endAllocation(h.deps)(testPrincipal(), budget.id, allocation.id, allocation.version, "2026-03-31");
    expect(ended.effectiveTo).toBe("2026-03-31");

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.allocation_added" }),
      expect.objectContaining({ action: "budgets.allocation_ended", entityId: allocation.id }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events.map((e) => e.kind).sort()).toEqual(["allocation_added", "allocation_ended"]);
  });
});
