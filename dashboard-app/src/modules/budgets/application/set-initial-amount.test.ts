import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { NotFoundError } from "./errors";
import { setInitialAmount } from "./set-initial-amount";
import { budgetHarness, seedBudget } from "./test-support";

describe("setInitialAmount", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(
      setInitialAmount(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, { initialAmount: "100.00", effectiveFrom: "2026-02-01" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(
      setInitialAmount(h.deps)(testPrincipal(), "missing", { initialAmount: "100.00", effectiveFrom: "2026-02-01" }),
    ).rejects.toThrow(NotFoundError);
  });

  it("adds a version and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const version = await setInitialAmount(h.deps)(testPrincipal(), budget.id, {
      initialAmount: "250.00",
      effectiveFrom: "2026-03-01",
      reason: "raise",
    });
    expect(version).toMatchObject({ budgetId: budget.id, initialAmount: "250.00", effectiveFrom: "2026-03-01", reason: "raise" });

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.amount_version_set", entityId: version.id }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([expect.objectContaining({ kind: "amount_version_set" })]);
  });
});
