import { getTransaction } from "../application/get-transaction";
import { NotFoundError } from "../application/errors";
import { listCategories } from "../application/list-categories";
import { listLabels } from "../application/list-labels";
import { listTransactions } from "../application/list-transactions";
import type { ListTransactionsOptions } from "../application/ports";
import { runForPrincipal } from "./run";

/** Dates flattened to ISO strings so the row stays serialisable across the server/client boundary, matching the accounts module's row shape. */
export interface TransactionRow {
  id: string;
  occurredAt: string;
  amount: string;
  currency: string;
  type: string;
  state: string;
  payee: string | null;
  note: string | null;
  categoryId: string | null;
  categoryName: string | null;
  labelIds: string[];
  version: number;
}

function toRow(item: {
  transaction: {
    id: string;
    occurredAt: Date;
    amount: string;
    currency: string;
    type: string;
    state: string;
    payee: string | null;
    note: string | null;
    version: number;
  };
  category: { id: string; name: string } | null;
  labelIds: string[];
}): TransactionRow {
  return {
    id: item.transaction.id,
    occurredAt: item.transaction.occurredAt.toISOString(),
    amount: item.transaction.amount,
    currency: item.transaction.currency,
    type: item.transaction.type,
    state: item.transaction.state,
    payee: item.transaction.payee,
    note: item.transaction.note,
    categoryId: item.category?.id ?? null,
    categoryName: item.category?.name ?? null,
    labelIds: item.labelIds,
    version: item.transaction.version,
  };
}

export async function loadTransactionsPage(
  opts: ListTransactionsOptions,
): Promise<{ rows: TransactionRow[]; nextCursor: string | null }> {
  return runForPrincipal(async (deps, principal) => {
    const result = await listTransactions(deps)(principal, opts);
    return { rows: result.items.map(toRow), nextCursor: result.nextCursor };
  });
}

export async function loadTransactionDetail(id: string): Promise<{
  row: TransactionRow;
  categories: { id: string; name: string }[];
  labels: { id: string; name: string }[];
} | null> {
  return runForPrincipal(async (deps, principal) => {
    // Only a missing transaction renders as "not found" — anything else (a
    // database failure, a permission edge, a bug in the use case) is a real
    // error and must surface as one, not get erased into a 404.
    const detail = await getTransaction(deps)(principal, id).catch((err: unknown) => {
      if (err instanceof NotFoundError) return null;
      throw err;
    });
    if (!detail) return null;
    const [categories, labels] = await Promise.all([
      listCategories(deps)(principal),
      listLabels(deps)(principal),
    ]);
    return {
      row: toRow(detail),
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      labels: labels.map((l) => ({ id: l.id, name: l.name })),
    };
  });
}
