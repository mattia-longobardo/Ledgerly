import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";
import { updateBudget } from "./update-budget";

describe("updateBudget", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(updateBudget(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, budget.version, { name: "No" }))
      .rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(updateBudget(h.deps)(testPrincipal(), "missing", 1, { name: "x" })).rejects.toThrow(NotFoundError);
  });

  it("raises VersionMismatchError on a stale version", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(updateBudget(h.deps)(testPrincipal(), budget.id, budget.version + 1, { name: "x" })).rejects.toThrow(VersionMismatchError);
  });

  it("archives with the application clock and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const archived = await updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { status: "archived" });
    expect(archived.status).toBe("archived");
    expect(archived.archivedAt?.toISOString()).toBe("2026-09-06T10:00:00.000Z");
    expect(archived.archivedAt).toEqual(h.deps.clock.now());

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.budget_updated", entityId: budget.id, before: budget, after: archived }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([expect.objectContaining({ kind: "budget_updated" })]);
  });

  it("rejects a caller-supplied archivedAt with no status change — it must never desync from status", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(
      updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { archivedAt: new Date("2020-01-01T00:00:00.000Z") }),
    ).rejects.toThrow(InvalidInputError);

    const stored = await h.deps.budgets.get(testPrincipal().userId, budget.id);
    expect(stored).toMatchObject({ status: "active", archivedAt: null, version: budget.version });
    expect(h.audits).toEqual([]);
  });
});
