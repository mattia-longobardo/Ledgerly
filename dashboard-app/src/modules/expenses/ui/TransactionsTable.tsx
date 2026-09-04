"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import type { TransactionRow } from "./load-transactions";

export interface TransactionsTableProps {
  initialRows: readonly TransactionRow[];
  /** From the same page `initialRows` came from — `null` means that page was the last one. */
  initialNextCursor: string | null;
  /** The limit the initial server load used; "Load more" asks for the same size. */
  pageSize: number;
}

interface TransactionsApiItem {
  transaction: {
    id: string;
    occurredAt: string;
    amount: string;
    currency: string;
    type: string;
    state: string;
    payee: string | null;
    note: string | null;
    categoryId: string | null;
    version: number;
  };
  category: { id: string; name: string } | null;
  labelIds: string[];
}

interface TransactionsApiPage {
  items: TransactionsApiItem[];
  nextCursor: string | null;
}

function toRow(item: TransactionsApiItem): TransactionRow {
  return {
    id: item.transaction.id,
    occurredAt: item.transaction.occurredAt,
    amount: item.transaction.amount,
    currency: item.transaction.currency,
    type: item.transaction.type,
    state: item.transaction.state,
    payee: item.transaction.payee,
    note: item.transaction.note,
    // The API's raw `transaction.categoryId` survives even when `category` is
    // null (an archived category the list endpoint doesn't resolve a name
    // for) — falling back to it keeps the id honest instead of dropping it.
    categoryId: item.category?.id ?? item.transaction.categoryId,
    categoryName: item.category?.name ?? null,
    labelIds: item.labelIds,
    version: item.transaction.version,
  };
}

/**
 * Wallet is connected, but nothing has synced yet — deliberately not the
 * "Connect Budget Makers Wallet" empty state one level up: that one means
 * "go connect something", this one means "connected, wait for the sync".
 *
 * The first page is server-rendered; `nextCursor` is never silently dropped
 * even when it exists — a user with more than `pageSize` transactions gets an
 * explicit "Load more" pulling the real next page from `GET /api/v1/transactions`
 * (same session cookie), never a list that quietly stops at the limit with no
 * sign anything is missing. Mirrors `BalanceHistoryTable`.
 */
export function TransactionsTable({ initialRows, initialNextCursor, pageSize }: TransactionsTableProps) {
  const [rows, setRows] = useState(initialRows);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (cursor === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/v1/transactions?cursor=${encodeURIComponent(cursor)}&limit=${pageSize}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as TransactionsApiPage;
        setRows((prev) => [...prev, ...data.items.map(toRow)]);
        setCursor(data.nextCursor);
      } catch {
        setError("Could not load more transactions.");
      }
    });
  }

  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-body-sm text-fg-muted">
        No transactions yet — the next sync will fill this in.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="text-left text-fg-muted">
              <th className="py-2 font-normal">Date</th>
              <th className="font-normal">Payee</th>
              <th className="font-normal">Category</th>
              <th className="text-right font-normal">Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="hairline-t">
                <td className="py-2 whitespace-nowrap text-fg-muted">
                  {new Date(r.occurredAt).toLocaleDateString()}
                </td>
                <td className="min-w-0">
                  <Link
                    href={`/finance/expenses/${r.id}`}
                    className="text-fg underline-offset-2 hover:underline"
                  >
                    {r.payee ?? "—"}
                  </Link>
                </td>
                <td className={r.categoryName === null ? "text-fg-muted" : "text-fg"}>
                  {r.categoryName ?? "Uncategorized"}
                </td>
                <td className="text-right">
                  <MoneyValue value={r.amount} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error !== null && <ErrorInline message={error} onRetry={loadMore} />}

      {cursor !== null && (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          className="self-start rounded-md border border-border px-3 py-1.5 text-body-sm text-fg transition-colors hover:bg-surface-hover disabled:opacity-40"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
