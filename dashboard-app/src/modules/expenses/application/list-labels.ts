import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionLabel } from "../domain/transaction";
import type { UseCaseDeps } from "./ports";

export function listLabels(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TransactionLabel[]> => {
    assertPermission(principal, "expenses.read");
    return deps.labels.list(principal.userId);
  };
}
