import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { Usage, UseCaseDeps } from "./ports";
import { dateSchema, moneyCents, moneySchema, parseInput } from "./validation";

export interface AddManualUsageInput {
  amount: string;
  occurredAt: string;
  note?: string | null;
}

const schema = z.object({
  amount: moneySchema,
  occurredAt: dateSchema,
  note: z.string().nullable().optional(),
}).strict();

export function addManualUsage(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string, input: AddManualUsageInput): Promise<Usage> => {
    assertPermission(principal, "budgets.write");
    const value = parseInput(schema, input);
    if (moneyCents(value.amount) <= 0n) throw new InvalidInputError("Usage amount must be greater than zero.");

    const budget = await deps.budgets.get(principal.userId, budgetId);
    if (!budget) throw new NotFoundError();

    const usage = await deps.usages.create({
      budgetId,
      transactionId: null,
      amount: value.amount,
      occurredAt: value.occurredAt,
      matchedBy: "manual",
      note: value.note ?? null,
    });
    await deps.audit({ actorUserId: principal.userId, action: "budgets.usage_added", entityType: "budget_usage", entityId: usage.id, after: usage });
    await deps.events.add({ budgetId, kind: "usage_added", detail: { usage }, actorUserId: principal.userId });
    return usage;
  };
}
