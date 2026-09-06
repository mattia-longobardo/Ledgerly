import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import { InvalidInputError, NotFoundError } from "./errors";
import type { Budget, BudgetPatch, UseCaseDeps } from "./ports";
import { BUDGET_STATUSES, dateSchema, nonNegativeMoneySchema, parseInput, PERIOD_KINDS } from "./validation";

/**
 * `archivedAt` is deliberately absent here: it is set only by this use
 * case's own `status === "archived"` branch below, never by the caller —
 * `BudgetPatch` (the repository's write surface) still carries it, but the
 * externally-parsed input must not, or a caller could desync `status`
 * (still `"active"`) from a caller-supplied `archivedAt`. `.strict()`
 * rejects a patch that tries to set it directly.
 */
const patchSchema = z.object({
  name: z.string().trim().min(1, "Invalid budget name.").optional(),
  description: z.string().nullable().optional(),
  periodKind: z.enum(PERIOD_KINDS).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.nullable().optional(),
  goalAmount: nonNegativeMoneySchema.nullable().optional(),
  labels: z.array(z.string()).optional(),
  status: z.enum(BUDGET_STATUSES).optional(),
}).strict();

export function updateBudget(deps: UseCaseDeps) {
  return async (principal: Principal, id: string, expectedVersion: number, patch: BudgetPatch): Promise<Budget> => {
    assertPermission(principal, "budgets.write");
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new InvalidInputError("Invalid budget version.");
    const value = parseInput(patchSchema, patch);
    const before = await deps.budgets.get(principal.userId, id);
    if (!before) throw new NotFoundError();
    const effectivePatch: BudgetPatch = { ...value };
    if (value.status === "archived") effectivePatch.archivedAt = deps.clock.now();
    if (value.status === "active") effectivePatch.archivedAt = null;
    const after = await deps.budgets.update(principal.userId, id, expectedVersion, effectivePatch);
    if (!after) throw new NotFoundError();
    await deps.audit({ actorUserId: principal.userId, action: "budgets.budget_updated", entityType: "budget", entityId: id, before, after });
    await deps.events.add({ budgetId: id, kind: "budget_updated", detail: { before, after }, actorUserId: principal.userId });
    return after;
  };
}
