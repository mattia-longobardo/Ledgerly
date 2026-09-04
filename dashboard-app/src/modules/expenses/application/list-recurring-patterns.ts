import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { RecurringPatternRecord, UseCaseDeps } from "./ports";

export function listRecurringPatterns(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<RecurringPatternRecord[]> => {
    assertPermission(principal, "expenses.read");
    return deps.recurring.list(principal.userId);
  };
}
