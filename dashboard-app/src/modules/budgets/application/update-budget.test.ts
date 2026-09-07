import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { InvalidInputError, NotFoundError, VersionMismatchError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";
import { updateBudget } from "./update-budget";

describe("updateBudget", () => {
  it("rejects a patch that inverts the stored date pair — a `budgets_dates_ck` violation would surface as a 500", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps, { startDate: "2026-01-01", endDate: "2026-12-31" });

    // Only `endDate` is in the patch; `startDate` comes from the stored row.
    await expect(
      updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { endDate: "2020-01-01" }),
    ).rejects.toThrow(InvalidInputError);

    // And the mirror case: only `startDate` is in the patch.
    await expect(
      updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { startDate: "2027-06-01" }),
    ).rejects.toThrow(InvalidInputError);

    // Clearing `endDate` leaves nothing to invert, so it stays valid.
    const cleared = await updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { endDate: null });
    expect(cleared.endDate).toBeNull();
  });

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

  it("clears archivedAt when un-archiving — status and archivedAt must never desync from either direction", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const archived = await updateBudget(h.deps)(testPrincipal(), budget.id, budget.version, { status: "archived" });
    expect(archived.archivedAt).not.toBeNull();

    const reactivated = await updateBudget(h.deps)(testPrincipal(), archived.id, archived.version, { status: "active" });
    expect(reactivated.status).toBe("active");
    expect(reactivated.archivedAt).toBeNull();
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
