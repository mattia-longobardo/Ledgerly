import { describe, expect, it } from "vitest";
import { PermissionDeniedError } from "@/platform/auth/principal";
import { testPrincipal } from "@/test/principal";
import { createBudget } from "./create-budget";
import { InvalidInputError } from "./errors";
import { budgetHarness } from "./test-support";

const input = {
  name: "Groceries",
  description: null,
  currency: "EUR",
  periodKind: "monthly" as const,
  startDate: "2026-01-01",
  endDate: null,
  goalAmount: null,
  labels: [],
  initialAmount: "300.00",
};

describe("createBudget", () => {
  it("denies viewers", async () => {
    const h = budgetHarness();
    await expect(createBudget(h.deps)(testPrincipal({ roles: ["viewer"] }), input)).rejects.toThrow(PermissionDeniedError);
  });

  it("rejects invalid input", async () => {
    const h = budgetHarness();
    await expect(createBudget(h.deps)(testPrincipal(), { ...input, periodKind: "bad" as never })).rejects.toThrow(InvalidInputError);
  });

  it("creates the budget, writes the first amount version, and audits and logs the event", async () => {
    const h = budgetHarness();
    const budget = await createBudget(h.deps)(testPrincipal(), input);
    expect(budget.name).toBe("Groceries");

    const versions = await h.deps.versions.listForBudget(budget.id);
    expect(versions).toEqual([
      expect.objectContaining({ initialAmount: "300.00", effectiveFrom: "2026-01-01" }),
    ]);

    expect(h.audits).toEqual([
      expect.objectContaining({ action: "budgets.budget_created", entityId: budget.id }),
    ]);
    const events = await h.deps.events.listForBudget(budget.id);
    expect(events).toEqual([
      expect.objectContaining({ budgetId: budget.id, kind: "budget_created" }),
    ]);
  });
});
