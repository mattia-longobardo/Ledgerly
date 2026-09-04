import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { TransactionCategory } from "../domain/transaction";
import type { UseCaseDeps } from "./ports";

export function listCategories(deps: UseCaseDeps) {
  return async (principal: Principal): Promise<TransactionCategory[]> => {
    assertPermission(principal, "expenses.read");
    return deps.categories.list(principal.userId);
  };
}
