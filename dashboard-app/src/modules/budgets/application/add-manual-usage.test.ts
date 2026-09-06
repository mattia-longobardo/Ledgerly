import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { addManualUsage } from "./add-manual-usage";
import { InvalidInputError, NotFoundError } from "./errors";
import { budgetHarness, seedBudget } from "./test-support";

describe("addManualUsage", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(
      addManualUsage(h.deps)(testPrincipal({ roles: ["viewer"] }), budget.id, { amount: "10.00", occurredAt: "2026-02-01" }),
    ).rejects.toThrow(PermissionDeniedError);
  });

  it("raises NotFoundError for a missing budget", async () => {
    const h = budgetHarness();
    await expect(addManualUsage(h.deps)(testPrincipal(), "missing", { amount: "10.00", occurredAt: "2026-02-01" })).rejects.toThrow(
      NotFoundError,
    );
  });

  it("rejects a zero or negative amount", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    await expect(addManualUsage(h.deps)(testPrincipal(), budget.id, { amount: "0.00", occurredAt: "2026-02-01" })).rejects.toThrow(
      InvalidInputError,
    );
    await expect(addManualUsage(h.deps)(testPrincipal(), budget.id, { amount: "-5.00", occurredAt: "2026-02-01" })).rejects.toThrow(
      InvalidInputError,
    );
  });

  it("creates a manual usage and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await seedBudget(h.deps);
    const usage = await addManualUsage(h.deps)(testPrincipal(), budget.id, { amount: "10.00", occurredAt: "2026-02-01", note: "cash" });
    expect(usage).toMatchObject({ budgetId: budget.id, amount: "10.00", matchedBy: "manual", transactionId: null, note: "cash" });

    expect(h.audits).toEqual([expect.objectContaining({ action: "budgets.usage_added", entityId: usage.id })]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([expect.objectContaining({ kind: "usage_added" })]);
  });
});
