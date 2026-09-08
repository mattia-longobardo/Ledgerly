"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addAllocationAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { OptionRow } from "./load-budgets";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export interface AllocationFormProps {
  budgetId: string;
  today: string;
  accounts: readonly OptionRow[];
  funds: readonly OptionRow[];
}

/**
 * Every allocation this form creates is a planning figure only — it never
 * moves money or changes the source account's or fund's balance (spec §5.6).
 * The note under the amount field says so; `AllocationsTable` repeats the
 * label on every row so the fact stays visible after the form closes.
 */
export function AllocationForm({ budgetId, today, accounts, funds }: AllocationFormProps) {
  const router = useRouter();
  const [sourceKind, setSourceKind] = useState<"fund" | "account" | "none">("none");
  const [sourceId, setSourceId] = useState("");
  const [amount, setAmount] = useState("");
  const [recurrence, setRecurrence] = useState<"once" | "monthly">("monthly");
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [effectiveTo, setEffectiveTo] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = sourceKind === "fund" ? funds : sourceKind === "account" ? accounts : [];

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await addAllocationAction(data);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setAmount("");
          setNote("");
          setEffectiveTo("");
          router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="budgetId" value={budgetId} />
      {error && <ErrorInline message={error} />}
      <p className="text-body-sm text-fg-muted">
        An allocation is a planning value: it never moves money out of the source or changes its balance.
      </p>
      <div className="grid gap-3 @xl:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Source</span>
          <select
            name="sourceKind"
            value={sourceKind}
            onChange={(event) => {
              setSourceKind(event.target.value as "fund" | "account" | "none");
              setSourceId("");
            }}
            className={FIELD}
          >
            <option value="none">No source</option>
            <option value="fund">Fund</option>
            <option value="account">Account</option>
          </select>
        </label>
        {sourceKind !== "none" && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>{sourceKind === "fund" ? "Fund" : "Account"}</span>
            <select name="sourceId" value={sourceId} onChange={(event) => setSourceId(event.target.value)} required className={FIELD}>
              <option value="" disabled>
                Choose one
              </option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Amount</span>
          <input name="amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="100,00" required className={`${FIELD} num`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Recurrence</span>
          <select name="recurrence" value={recurrence} onChange={(event) => setRecurrence(event.target.value as "once" | "monthly")} className={FIELD}>
            <option value="monthly">Monthly</option>
            <option value="once">Once</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Effective from</span>
          <input name="effectiveFrom" type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} required className={`${FIELD} num`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Effective to (optional)</span>
          <input name="effectiveTo" type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className={`${FIELD} num`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Note (optional)</span>
          <input name="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className={FIELD} />
        </label>
      </div>
      <button type="submit" disabled={pending || amount.trim() === "" || (sourceKind !== "none" && sourceId === "")} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40">
        {pending ? "Adding…" : "Add allocation"}
      </button>
    </form>
  );
}
