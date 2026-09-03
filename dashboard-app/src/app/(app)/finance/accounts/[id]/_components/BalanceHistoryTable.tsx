"use client";

import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";

export interface BalanceHistoryRow {
  asOf: string;
  balance: string;
  source: string;
  capturedAt: string;
}

export interface BalanceHistoryTableProps {
  accountId: string;
  initialItems: readonly BalanceHistoryRow[];
  initialNextCursor: string | null;
  pageSize: number;
}

interface BalancesPageResponse {
  items: BalanceHistoryRow[];
  nextCursor?: string;
}

/**
 * The first page is server-rendered; "Load more" talks to the real API
 * (`GET /accounts/{id}/balances`) with the same session cookie, so a history
 * longer than the trend window the detail read keeps in memory is still
 * reachable without the page ever loading it all at once.
 */
export function BalanceHistoryTable({
  accountId,
  initialItems,
  initialNextCursor,
  pageSize,
}: BalanceHistoryTableProps) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialNextCursor);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function loadMore() {
    if (cursor === null) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/v1/accounts/${accountId}/balances?cursor=${encodeURIComponent(cursor)}&limit=${pageSize}`,
          { credentials: "same-origin" },
        );
        if (!res.ok) throw new Error();
        const data = (await res.json()) as BalancesPageResponse;
        setItems((prev) => [...prev, ...data.items]);
        setCursor(data.nextCursor ?? null);
      } catch {
        setError("Could not load more balances.");
      }
    });
  }

  if (items.length === 0) {
    return (
      <p className="text-body-sm text-fg-muted">No balances recorded yet.</p>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-72 border-collapse">
          <thead>
            <tr className="hairline-b">
              <th
                scope="col"
                className="py-2 pr-3 text-left text-caption tracking-wide text-fg-muted uppercase"
              >
                Date
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-right text-caption tracking-wide text-fg-muted uppercase"
              >
                Balance
              </th>
              <th
                scope="col"
                className="py-2 pl-3 text-left text-caption tracking-wide text-fg-muted uppercase"
              >
                Source
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((point) => (
              <tr
                key={`${point.asOf}-${point.source}-${point.capturedAt}`}
                className="hairline-b"
              >
                <th
                  scope="row"
                  className="num py-1.5 pr-3 text-left text-body-sm font-normal text-fg"
                >
                  {point.asOf}
                </th>
                <td className="num px-3 py-1.5 text-right text-body-sm text-fg">
                  <MoneyValue value={point.balance} size="body" cents="full" />
                </td>
                <td className="py-1.5 pl-3 text-left text-body-sm text-fg-muted capitalize">
                  {point.source}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error !== null && (
        <div className="mt-3">
          <ErrorInline message={error} onRetry={loadMore} />
        </div>
      )}

      {cursor !== null && (
        <button
          type="button"
          disabled={pending}
          onClick={loadMore}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
        >
          {pending ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
