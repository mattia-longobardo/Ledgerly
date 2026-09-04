"use client";

import Link from "next/link";
import { MoneyValue } from "@/components/ui/MoneyValue";
import type { TransactionRow } from "./load-transactions";

export interface TransactionsTableProps {
  rows: readonly TransactionRow[];
}

/**
 * Wallet is connected, but nothing has synced yet — deliberately not the
 * "Connect Budget Makers Wallet" empty state one level up: that one means
 * "go connect something", this one means "connected, wait for the sync".
 */
export function TransactionsTable({ rows }: TransactionsTableProps) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-body-sm text-fg-muted">
        No transactions yet — the next sync will fill this in.
      </p>
    );
  }

  return (
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
  );
}
