"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { reverseContributionAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { formatMonth } from "@/lib/format";
import type { FundContribution } from "../application/ports";
import { formatCurrency } from "./CurrencyValue";

function title(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

export function ContributionsTable({ rows, fundId, canWrite }: { rows: readonly FundContribution[]; fundId: string; canWrite: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const reversed = new Set(rows.map((row) => row.reversesId).filter((id): id is string => id !== null));

  if (rows.length === 0) return <p className="py-5 text-body-sm text-fg-muted">No contributions recorded.</p>;

  function reverse(id: string) {
    const data = new FormData();
    data.set("fundId", fundId);
    data.set("contributionId", id);
    setError(null);
    setPendingId(id);
    startTransition(async () => {
      const result = await reverseContributionAction(data);
      setPendingId(null);
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  }

  return <div className="flex flex-col gap-4">
    {error && <ErrorInline message={error} />}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] border-collapse text-body-sm">
        <thead><tr className="hairline-b text-left text-caption tracking-wide text-fg-muted uppercase"><th className="py-2 pr-3 font-normal">Accrual</th><th className="px-3 py-2 font-normal">Posting</th><th className="px-3 py-2 font-normal">Type</th><th className="px-3 py-2 font-normal">Source</th><th className="px-3 py-2 text-right font-normal">Amount</th><th className="py-2 pl-3 text-right font-normal"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{[...rows].sort((a, b) => b.postedMonth.localeCompare(a.postedMonth) || b.createdAt.getTime() - a.createdAt.getTime()).map((row) => {
          const canReverse = canWrite && row.typeCode !== "reversal" && !reversed.has(row.id);
          return <tr key={row.id} className="hairline-b">
            <td className="num py-2 pr-3 text-fg">{row.accrualPeriodStart === row.accrualPeriodEnd ? formatMonth(row.accrualPeriodStart) : `${formatMonth(row.accrualPeriodStart)} – ${formatMonth(row.accrualPeriodEnd)}`}</td>
            <td className="num px-3 py-2 text-fg-muted">{formatMonth(row.postedMonth)}</td>
            <td className="px-3 py-2 text-fg">{title(row.typeCode)}</td>
            <td className="px-3 py-2">{row.payrollRecordId ? <Link href={`/company/earnings/${row.payrollRecordId}`} className="text-accent underline-offset-2 hover:underline">Payroll record</Link> : <span className="text-fg-muted">{title(row.source)}</span>}</td>
            <td className="num px-3 py-2 text-right text-fg">{formatCurrency(row.amount, row.currency)}</td>
            <td className="py-2 pl-3 text-right">{canReverse ? <button type="button" onClick={() => reverse(row.id)} disabled={pending && pendingId === row.id} className="inline-flex min-h-11 items-center rounded-md border border-border px-3 text-body-sm text-fg disabled:opacity-40">{pending && pendingId === row.id ? "Reversing…" : "Reverse"}</button> : reversed.has(row.id) ? <span className="text-caption text-fg-muted">Reversed</span> : null}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </div>;
}
