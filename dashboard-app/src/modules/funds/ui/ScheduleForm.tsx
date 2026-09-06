"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { setScheduleAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";
import type { FundSchedule } from "../application/ports";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function ScheduleForm({ fundId, schedule, currentMonth, currency }: { fundId: string; schedule: FundSchedule | null; currentMonth: string; currency: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return <form onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setError(null); startTransition(async () => { const result = await setScheduleAction(data); if (!result.ok) { setError(result.error); return; } router.refresh(); }); }} className="flex flex-col gap-4">
    <input type="hidden" name="fundId" value={fundId} />
    {error && <ErrorInline message={error} />}
    <div className="grid gap-3 @xl:grid-cols-2">
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Frequency</span><select name="frequency" defaultValue={schedule?.frequency ?? "monthly"} className={FIELD}><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="annual">Annual</option></select></label>
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Period anchor month</span><input name="periodAnchorMonth" type="number" min={1} max={12} defaultValue={schedule?.periodAnchorMonth ?? 1} required className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Posting lag (months)</span><input name="postingLagMonths" type="number" min={0} max={12} defaultValue={schedule?.postingLagMonths ?? 0} required className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5"><span className={LABEL}>Fee per posting ({currency})</span><input name="feePerPosting" inputMode="decimal" defaultValue={schedule?.feePerPosting ?? "0.00"} required className={`${FIELD} num`} /></label>
      <label className="flex flex-col gap-1.5 @xl:col-span-2"><span className={LABEL}>Effective from</span><input name="effectiveFrom" type="month" defaultValue={(schedule?.effectiveFrom ?? currentMonth).slice(0, 7)} required className={`${FIELD} num`} /></label>
    </div>
    <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40">{pending ? "Saving…" : "Save schedule"}</button>
  </form>;
}
