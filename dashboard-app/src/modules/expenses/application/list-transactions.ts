import type { Principal } from "@/platform/auth/principal";
import { assertPermission } from "@/platform/auth/principal";
import type { Transaction, TransactionCategory } from "../domain/transaction";
import type { ListTransactionsOptions, UseCaseDeps } from "./ports";

export interface TransactionListItem {
  transaction: Transaction;
  category: TransactionCategory | null;
  labelIds: string[];
}

export interface ListTransactionsResult {
  items: TransactionListItem[];
  nextCursor: string | null;
}

export function listTransactions(deps: UseCaseDeps) {
  return async (principal: Principal, opts: ListTransactionsOptions): Promise<ListTransactionsResult> => {
    assertPermission(principal, "expenses.read");
    const page = await deps.transactions.list(principal.userId, opts);
    const categories = await deps.categories.list(principal.userId, { includeArchived: true });
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    const items = page.items.map((t) => ({
      transaction: t,
      category: t.categoryId ? (categoryById.get(t.categoryId) ?? null) : null,
      labelIds: page.labelsByTransaction.get(t.id) ?? [],
    }));
    return { items, nextCursor: page.nextCursor };
  };
}
