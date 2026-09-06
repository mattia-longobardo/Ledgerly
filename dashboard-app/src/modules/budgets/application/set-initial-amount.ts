import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { AmountVersion, UseCaseDeps } from "./ports";
import { dateSchema, moneySchema, parseInput } from "./validation";

const schema = z.object({
  initialAmount: moneySchema,
  effectiveFrom: dateSchema,
  reason: z.string().nullable().optional(),
}).strict();

export interface SetInitialAmountInput {
  initialAmount: string;
  effectiveFrom: string;
  reason?: string | null;
}

export function setInitialAmount(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string, input: SetInitialAmountInput): Promise<AmountVersion> => {
    assertPermission(principal, "budgets.write");
    const value = parseInput(schema, input);
    const budget = await deps.budgets.get(principal.userId, budgetId);
    if (!budget) throw new NotFoundError();
    const version = await deps.versions.add({
      budgetId,
      initialAmount: value.initialAmount,
      effectiveFrom: value.effectiveFrom,
      reason: value.reason ?? null,
      actorUserId: principal.userId,
    });
    await deps.audit({
      actorUserId: principal.userId,
      action: "budgets.amount_version_set",
      entityType: "budget_amount_version",
      entityId: version.id,
      after: version,
    });
    await deps.events.add({ budgetId, kind: "amount_version_set", detail: { version }, actorUserId: principal.userId });
    return version;
  };
}
