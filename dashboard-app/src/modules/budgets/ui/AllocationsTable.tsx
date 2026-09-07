"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { endAllocationAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { formatMonth } from "@/lib/format";
import type { AllocationView } from "./load-budgets";

function recurrenceLabel(value: "once" | "monthly"): string {
  return value === "monthly" ? "Monthly" : "Once";
}

function EndAllocationAction({ budgetId, allocation, today }: { budgetId: string; allocation: AllocationView; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [effectiveTo, setEffectiveTo] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (allocation.effectiveTo !== null) {
    return <span className="text-caption text-fg-muted">Ended {allocation.effectiveTo}</span>;
  }

  // A `once` allocation contributes its full amount regardless of
  // `effectiveTo` (see `allocatedThrough`), so ending one would change
  // nothing while claiming it had. `endAllocation` rejects it too.
  if (allocation.recurrence === "once") {
    return <span className="text-caption text-fg-muted">—</span>;
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-body-sm font-medium text-fg">
        End
      </button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error && <ErrorInline message={error} />}
      <div className="flex items-center gap-2">
        <input
          type="date"
          value={effectiveTo}
          min={allocation.effectiveFrom}
          onChange={(event) => setEffectiveTo(event.target.value)}
          className="num min-h-11 rounded-md border border-border bg-surface px-2 text-body-sm text-fg"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            const data = new FormData();
            data.set("budgetId", budgetId);
            data.set("allocationId", allocation.id);
            data.set("version", String(allocation.version));
            data.set("effectiveTo", effectiveTo);
            setError(null);
            startTransition(async () => {
              const result = await endAllocationAction(data);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setOpen(false);
              router.refresh();
            });
          }}
          className="inline-flex min-h-11 items-center rounded-md bg-accent px-3 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
        >
          {pending ? "Ending…" : "Confirm"}
        </button>
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-body-sm text-fg disabled:opacity-40">
          Cancel
        </button>
      </div>
    </div>
  );
}

export function AllocationsTable({ rows, budgetId, canWrite, today }: { rows: readonly AllocationView[]; budgetId: string; canWrite: boolean; today: string }) {
  if (rows.length === 0) return <p className="py-5 text-body-sm text-fg-muted">No allocations yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[50rem] border-collapse text-body-sm">
        <thead>
          <tr className="hairline-b text-left text-caption tracking-wide text-fg-muted uppercase">
            <th className="py-2 pr-3 font-normal">Source</th>
            <th className="px-3 py-2 text-right font-normal">Amount (planning value)</th>
            <th className="px-3 py-2 font-normal">Recurrence</th>
            <th className="px-3 py-2 font-normal">Dates</th>
            <th className="px-3 py-2 text-right font-normal">Available in source</th>
            {canWrite && (
              <th className="relative py-2 pl-3 text-right font-normal">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {[...rows].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map((allocation) => (
            <tr key={allocation.id} className="hairline-b">
              <td className="px-3 py-2 text-fg">{allocation.sourceKind === "none" ? "No source" : (allocation.sourceLabel ?? "Deleted")}</td>
              <td className="num px-3 py-2 text-right text-fg">
                <MoneyValue value={allocation.amount} />
              </td>
              <td className="px-3 py-2 text-fg-muted">{recurrenceLabel(allocation.recurrence)}</td>
              <td className="num px-3 py-2 text-fg-muted">
                {formatMonth(`${allocation.effectiveFrom.slice(0, 7)}-01`)}
                {allocation.effectiveTo ? ` – ${formatMonth(`${allocation.effectiveTo.slice(0, 7)}-01`)}` : ""}
              </td>
              <td className="num px-3 py-2 text-right text-fg-muted">
                {allocation.sourceKind === "none" ? "—" : allocation.availableInSource === null ? "—" : <MoneyValue value={allocation.availableInSource} />}
              </td>
              {canWrite && (
                <td className="py-2 pl-3 text-right">
                  <EndAllocationAction budgetId={budgetId} allocation={allocation} today={today} />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
