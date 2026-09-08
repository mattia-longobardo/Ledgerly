import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

/** A scope-matched row is not a manual row: deleting it raises `NotFoundError`, the same as a missing id. */
export function deleteManualUsage(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string, usageId: string): Promise<void> => {
    assertPermission(principal, "budgets.write");
    const usage = await deps.usages.get(budgetId, usageId);
    if (!usage || usage.matchedBy !== "manual") throw new NotFoundError();

    await deps.usages.delete(budgetId, usageId);
    await deps.audit({ actorUserId: principal.userId, action: "budgets.usage_deleted", entityType: "budget_usage", entityId: usageId, before: usage });
    await deps.events.add({ budgetId, kind: "usage_deleted", detail: { usage }, actorUserId: principal.userId });
  };
}
