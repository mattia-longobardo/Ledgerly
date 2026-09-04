import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Transaction, TransactionCategory } from "../domain/transaction";
import { NotFoundError } from "./errors";
import type { UseCaseDeps } from "./ports";

export interface TransactionDetail {
  transaction: Transaction;
  category: TransactionCategory | null;
  labelIds: string[];
}

export function getTransaction(deps: UseCaseDeps) {
  return async (principal: Principal, id: string): Promise<TransactionDetail> => {
    assertPermission(principal, "expenses.read");
    const transaction = await deps.transactions.get(principal.userId, id);
    if (!transaction) throw new NotFoundError();
    const category = transaction.categoryId ? await deps.categories.get(principal.userId, transaction.categoryId) : null;
    const labelIds = (await deps.transactions.labelsFor(principal.userId, [id])).get(id) ?? [];
    return { transaction, category, labelIds };
  };
}
