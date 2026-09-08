"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setPlanAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { FundPlan } from "../application/ports";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function PlanForm({ fundId, plan, currentMonth, currency, hasPlans }: { fundId: string; plan: FundPlan | null; currentMonth: string; currency: string; hasPlans: boolean }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setError(null); startTransition(async () => { const result = await setPlanAction(data); if (!result.ok) { setError(result.error); return; } router.refresh(); }); }} className="flex flex-col gap-4">
    <input type="hidden" name="fundId" value={fundId} />
    {error && <ErrorInline message={error} />}
    <div className="grid gap-3 @xl:grid-cols-2">
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Opening capital ({currency})</span><input name="initialCapital" inputMode="decimal" defaultValue={plan?.initialCapital ?? "0.00"} required className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Monthly forecast ({currency})</span><input name="fixedMonthlyAmount" inputMode="decimal" defaultValue={plan?.fixedMonthlyAmount ?? ""} placeholder="Optional" className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5 @xl:col-span-2"><span className={LABEL}>Effective from</span><input name="effectiveFrom" type="month" defaultValue={(plan?.effectiveFrom ?? currentMonth).slice(0, 7)} required className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5 @xl:col-span-2"><span className={LABEL}>Note (optional)</span><textarea name="note" defaultValue={plan?.note ?? ""} maxLength={2000} rows={3} className={`${FIELD} min-h-20 py-2`} /></label>
    </div>
    <p className="text-body-sm text-fg-muted">The monthly amount is a forecast and does not record paid contributions. {hasPlans ? "Opening capital has already been established." : "Saving the first plan records non-zero opening capital once as an adjustment."}</p>
    <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40">{pending ? "Saving…" : "Save plan"}</button>
  </form>;
}
