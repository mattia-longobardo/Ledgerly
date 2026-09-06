import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Budget, NewBudget, UseCaseDeps } from "./ports";
import { currencySchema, dateSchema, moneySchema, nonNegativeMoneySchema, parseInput, PERIOD_KINDS } from "./validation";

const schema = z.object({
  name: z.string().trim().min(1, "Invalid budget name."),
  description: z.string().nullable(),
  currency: currencySchema,
  periodKind: z.enum(PERIOD_KINDS),
  startDate: dateSchema,
  endDate: dateSchema.nullable(),
  goalAmount: nonNegativeMoneySchema.nullable(),
  labels: z.array(z.string()),
  initialAmount: moneySchema,
}).strict();

export function createBudget(deps: UseCaseDeps) {
  return async (principal: Principal, input: Omit<NewBudget, "userId"> & { initialAmount: string }): Promise<Budget> => {
    assertPermission(principal, "budgets.write");
    const value = parseInput(schema, input);
    const budget = await deps.budgets.create({
      userId: principal.userId,
      name: value.name,
      description: value.description,
      currency: value.currency,
      periodKind: value.periodKind,
      startDate: value.startDate,
      endDate: value.endDate,
      goalAmount: value.goalAmount,
      labels: value.labels,
    });
    await deps.versions.add({
      budgetId: budget.id,
      initialAmount: value.initialAmount,
      effectiveFrom: budget.startDate,
      reason: null,
      actorUserId: principal.userId,
    });
    await deps.audit({ actorUserId: principal.userId, action: "budgets.budget_created", entityType: "budget", entityId: budget.id, after: budget });
    await deps.events.add({ budgetId: budget.id, kind: "budget_created", detail: { budget }, actorUserId: principal.userId });
    return budget;
  };
}
