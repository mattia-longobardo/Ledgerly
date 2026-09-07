import { z } from "zod";
import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { ScopeLike } from "../domain/scopes";
import { NotFoundError } from "./errors";
import type { Scope, UseCaseDeps } from "./ports";
import { refreshUsages } from "./refresh-usages";
import { parseInput, SCOPE_KINDS } from "./validation";

const scopesSchema = z.array(z.object({ kind: z.enum(SCOPE_KINDS), refId: z.string().min(1) }).strict());

/**
 * `budget_scopes_uq` is unique on `(budgetId, kind, refId)`, so a repeated
 * `{kind, refId}` in the request is not a second scope — it is the same one
 * asked for twice, and sending it through would be a 500 from the Drizzle
 * repository (and silently accepted by the memory one). First occurrence
 * wins, so the caller's ordering is preserved.
 */
function dedupe(scopes: readonly ScopeLike[]): ScopeLike[] {
  const seen = new Set<string>();
  return scopes.filter((scope) => {
    const key = `${scope.kind}:${scope.refId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function setScopes(deps: UseCaseDeps) {
  return async (principal: Principal, budgetId: string, scopes: readonly ScopeLike[]): Promise<Scope[]> => {
    assertPermission(principal, "budgets.write");
    const value = dedupe(parseInput(scopesSchema, scopes));
    const budget = await deps.budgets.get(principal.userId, budgetId);
    if (!budget) throw new NotFoundError();

    const before = await deps.scopes.listForBudget(budgetId);
    const after = await deps.scopes.replace(budgetId, value);
    await deps.audit({ actorUserId: principal.userId, action: "budgets.scopes_set", entityType: "budget", entityId: budgetId, before, after });
    await deps.events.add({ budgetId, kind: "scopes_set", detail: { before, after }, actorUserId: principal.userId });

    await refreshUsages(deps)(principal, budgetId);
    return after;
  };
}
