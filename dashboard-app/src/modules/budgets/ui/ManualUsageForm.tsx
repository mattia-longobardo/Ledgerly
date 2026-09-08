"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addManualUsageAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function ManualUsageForm({ budgetId, today }: { budgetId: string; today: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          const result = await addManualUsageAction(data);
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setAmount("");
          setNote("");
          router.refresh();
        });
      }}
      className="flex flex-col gap-4"
    >
      <input type="hidden" name="budgetId" value={budgetId} />
      {error && <ErrorInline message={error} />}
      <div className="grid gap-3 @xl:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Amount</span>
          <input name="amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="25,00" required className={`${FIELD} num`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Date</span>
          <input name="occurredAt" type="date" value={occurredAt} onChange={(event) => setOccurredAt(event.target.value)} required className={`${FIELD} num`} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Note (optional)</span>
          <input name="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className={FIELD} />
        </label>
      </div>
      <p className="text-body-sm text-fg-muted">Use this for spending this budget's scopes can't see — cash, or an expense outside the tracked accounts.</p>
      <button type="submit" disabled={pending || amount.trim() === ""} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40">
        {pending ? "Adding…" : "Add usage"}
      </button>
    </form>
  );
}
