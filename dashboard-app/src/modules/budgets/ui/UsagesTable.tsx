"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteManualUsageAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import type { Usage } from "../application/ports";

export function UsagesTable({ rows, budgetId, canWrite }: { rows: readonly Usage[]; budgetId: string; canWrite: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (rows.length === 0) return <p className="py-5 text-body-sm text-fg-muted">No usage recorded yet.</p>;

  function deleteUsage(usageId: string) {
    const data = new FormData();
    data.set("budgetId", budgetId);
    data.set("usageId", usageId);
    setError(null);
    setPendingId(usageId);
    startTransition(async () => {
      const result = await deleteManualUsageAction(data);
      setPendingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <ErrorInline message={error} />}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-body-sm">
          <thead>
            <tr className="hairline-b text-left text-caption tracking-wide text-fg-muted uppercase">
              <th className="py-2 pr-3 font-normal">Date</th>
              <th className="px-3 py-2 font-normal">Note</th>
              <th className="px-3 py-2 text-right font-normal">Amount</th>
              <th className="relative py-2 pl-3 text-right font-normal">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...rows].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).map((usage) => (
              <tr key={usage.id} className="hairline-b">
                <td className="num py-2 pr-3 text-fg">{usage.occurredAt}</td>
                <td className="px-3 py-2 text-fg-muted">
                  {usage.matchedBy === "scope" && usage.transactionId ? (
                    <Link href={`/finance/expenses/${usage.transactionId}`} className="text-accent underline-offset-2 hover:underline">
                      {usage.note ?? "Matched expense"}
                    </Link>
                  ) : (
                    (usage.note ?? "Manual entry")
                  )}
                </td>
                <td className="num px-3 py-2 text-right text-fg">
                  <MoneyValue value={usage.amount} />
                </td>
                <td className="py-2 pl-3 text-right">
                  {canWrite && usage.matchedBy === "manual" ? (
                    <button
                      type="button"
                      onClick={() => deleteUsage(usage.id)}
                      disabled={pending && pendingId === usage.id}
                      className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-body-sm text-fg disabled:opacity-40"
                    >
                      {pending && pendingId === usage.id ? "Deleting…" : "Delete"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
