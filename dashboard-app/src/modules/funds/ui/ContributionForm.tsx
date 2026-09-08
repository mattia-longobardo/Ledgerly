"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addContributionAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function ContributionForm({ fundId, currentMonth, currency }: { fundId: string; currentMonth: string; currency: string }) {
  const router = useRouter();
  const [typeCode, setTypeCode] = useState("voluntary");
  const [accrualMonth, setAccrualMonth] = useState(currentMonth.slice(0, 7));
  const [postedMonth, setPostedMonth] = useState("");
  const [amount, setAmount] = useState("");
  const [valueDate, setValueDate] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setError(null);
      startTransition(async () => {
        const result = await addContributionAction(data);
        if (!result.ok) { setError(result.error); return; }
        setAmount(""); setNote(""); setPostedMonth(""); setValueDate("");
        router.refresh();
      });
    }} className="flex flex-col gap-4">
      <input type="hidden" name="fundId" value={fundId} />
      {error && <ErrorInline message={error} />}
      <div className="grid gap-3 @xl:grid-cols-2">
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Type</span><select name="typeCode" value={typeCode} onChange={(e) => setTypeCode(e.target.value)} className={FIELD}><option value="employee">Employee</option><option value="employer">Employer</option><option value="voluntary">Voluntary</option><option value="adjustment">Adjustment</option><option value="fee">Fee</option></select></label>
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Amount ({currency})</span><input name="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" placeholder={typeCode === "fee" ? "-3,00" : "100,00"} required className={`${FIELD} num`} /></label>
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Accrual month</span><input name="accrualMonth" type="month" value={accrualMonth} onChange={(e) => setAccrualMonth(e.target.value)} required className={`${FIELD} num`} /></label>
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Posting month (optional)</span><input name="postedMonth" type="month" value={postedMonth} onChange={(e) => setPostedMonth(e.target.value)} className={`${FIELD} num`} /></label>
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Value date (optional)</span><input name="valueDate" type="date" value={valueDate} onChange={(e) => setValueDate(e.target.value)} className={`${FIELD} num`} /></label>
        <label className="flex flex-col gap-1.5"><span className={LABEL}>Note (optional)</span><input name="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} className={FIELD} /></label>
      </div>
      <p className="text-body-sm text-fg-muted">Fees use a negative amount. The schedule calculates the posting month unless you set one here.</p>
      <button type="submit" disabled={pending || amount.trim() === ""} className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40">{pending ? "Adding…" : "Add contribution"}</button>
    </form>
  );
}
