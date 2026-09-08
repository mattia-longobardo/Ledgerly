import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addAllocation } from "./add-allocation";
import { InvalidInputError, NotFoundError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";

const base = {
  sourceKind: "none" as const,
  amount: "50.00",
  recurrence: "once" as const,
  effectiveFrom: "2026-02-01",
};

describe("addAllocation", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(addAllocation(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, base)).rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(addAllocation(h.deps)(testPrincipal(), "missing", base)).rejects.toThrow(NotFoundError);
  });

  it("rejects a zero amount", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(addAllocation(h.deps)(testPrincipal(), budget.id, { ...base, amount: "0.00" })).rejects.toThrow(InvalidInputError);
  });

  it("rejects a source id without ownership", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(
      addAllocation(h.deps)(testPrincipal(), budget.id, { ...base, sourceKind: "account", sourceId: "unknown-account" }),
    ).rejects.toThrow(InvalidInputError);

    await expect(
      addAllocation(h.deps)(testPrincipal(), budget.id, { ...base, sourceKind: "fund", sourceId: "unknown-fund" }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("rejects sourceKind 'none' with a non-null sourceId", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(
      addAllocation(h.deps)(testPrincipal(), budget.id, { ...base, sourceId: "account-1" }),
    ).rejects.toThrow(InvalidInputError);
  });

  it("creates an allocation against an owned account and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    h.accountOwners.add("account-1");
    const allocation = await addAllocation(h.deps)(testPrincipal(), budget.id, {
      ...base,
      sourceKind: "account",
      sourceId: "account-1",
    });
    expect(allocation).toMatchObject({ budgetId: budget.id, sourceKind: "account", sourceId: "account-1", amount: "50.00" });

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.allocation_added", entityId: allocation.id }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([expect.objectContaining({ kind: "allocation_added" })]);
  });
});
