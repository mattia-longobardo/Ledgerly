import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { Allocation, UseCaseDeps } from "./ports";
import { dateSchema, parseInput } from "./validation";

export function endAllocation(deps: UseCaseDeps) {
  return async (
    principal: Principal,
    budgetId: string,
    allocationId: string,
    expectedVersion: number,
    effectiveTo: string,
  ): Promise<Allocation> => {
    assertPermission(principal, "budgets.write");
    const value = parseInput(dateSchema, effectiveTo);
    const before = await deps.allocations.get(budgetId, allocationId);
    if (!before) throw new NotFoundError();
    if (value < before.effectiveFrom) throw new InvalidInputError("End date can't be before the allocation's start date.");
    const after = await deps.allocations.update(budgetId, allocationId, expectedVersion, { effectiveTo: value });
    if (!after) throw new NotFoundError();
    await deps.audit({
      actorUserId: principal.userId,
      action: "budgets.allocation_ended",
      entityType: "budget_allocation",
      entityId: after.id,
      before,
      after,
    });
    await deps.events.add({ budgetId, kind: "allocation_ended", detail: { before, after }, actorUserId: principal.userId });
    return after;
  };
}
