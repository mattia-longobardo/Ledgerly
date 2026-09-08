"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setInitialAmountAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import type { AmountVersion } from "../application/ports";
import type { BudgetFigures as Figures } from "../domain/figures";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export interface BudgetFiguresProps {
  budgetId: string;
  figures: Figures;
  versions: readonly AmountVersion[];
  canWrite: boolean;
  today: string;
}

/**
 * `allocated` is always labelled "planning value" (spec §5.6): an allocation
 * never moves money, so the figure it contributes here must never read like
 * a real transfer.
 */
export function BudgetFigures({ budgetId, figures, versions, canWrite, today }: BudgetFiguresProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-col gap-6">
      <StatGrid columns={4}>
        <StatTile label="Opening amount" value={<MoneyValue value={figures.initial} size="display-sm" />} />
        <StatTile label="Allocated" value={<MoneyValue value={figures.allocated} size="display-sm" />} sub="planning value" />
        <StatTile label="Used" value={<MoneyValue value={figures.used} size="display-sm" />} />
        <StatTile emphasis="primary" label="Remaining" value={<MoneyValue value={figures.remaining} size="display-sm" />} />
      </StatGrid>

      <div>
        <h3 className="text-caption tracking-wide text-fg-muted uppercase">Opening amount history</h3>
        {versions.length === 0 ? (
          <p className="mt-2 text-body-sm text-fg-muted">No opening amount recorded yet.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-body-sm">
            {[...versions].sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)).map((version) => (
              <li key={version.id} className="flex items-center justify-between gap-3">
                <span className="text-fg-muted">
                  {version.effectiveFrom}
                  {version.reason ? ` · ${version.reason}` : ""}
                </span>
                <MoneyValue value={version.initialAmount} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {canWrite &&
        (open ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              setError(null);
              startTransition(async () => {
                const result = await setInitialAmountAction(data);
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                setAmount("");
                setReason("");
                router.refresh();
              });
            }}
            className="flex flex-col gap-3 hairline-t pt-4"
          >
            <input type="hidden" name="budgetId" value={budgetId} />
            {error && <ErrorInline message={error} />}
            <div className="grid gap-3 @xl:grid-cols-3">
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Amount</span>
                <input name="initialAmount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" required className={`${FIELD} num`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Effective from</span>
                <input name="effectiveFrom" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required className={`${FIELD} num`} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Reason (optional)</span>
                <input name="reason" value={reason} onChange={(event) => setReason(event.target.value)} className={FIELD} />
              </label>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={pending || amount.trim() === ""} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40">
                {pending ? "Saving…" : "Save"}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm text-fg disabled:opacity-40">
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-11 items-center self-start rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg">
            Update opening amount
          </button>
        ))}
    </div>
  );
}
