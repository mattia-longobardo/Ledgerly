"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { acknowledgeIssueAction, reconcileFundAction } from "@/app/actions/funds";
import { ErrorInline } from "@/components/ui/ErrorInline";

function ActionButton({ label, pendingLabel, pending, onClick }: { label: string; pendingLabel: string; pending: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} disabled={pending} className="inline-flex min-h-11 items-center rounded-md border border-border bg-surface px-3 text-body-sm font-medium text-fg disabled:opacity-40">{pending ? pendingLabel : label}</button>;
}

export function ReconcileButton({ fundId }: { fundId: string }) {
  const router = useRouter(); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  return <div className="flex flex-col items-end gap-2">{error && <ErrorInline message={error} />}<ActionButton label="Reconcile" pendingLabel="Reconciling…" pending={pending} onClick={() => { const data = new FormData(); data.set("fundId", fundId); setError(null); startTransition(async () => { const result = await reconcileFundAction(data); if (!result.ok) { setError(result.error); return; } router.refresh(); }); }} /></div>;
}

export function AcknowledgeButton({ fundId, issueId }: { fundId: string; issueId: string }) {
  const router = useRouter(); const [error, setError] = useState<string | null>(null); const [pending, startTransition] = useTransition();
  return <div className="flex flex-col items-end gap-2">{error && <ErrorInline message={error} />}<ActionButton label="Acknowledge" pendingLabel="Saving…" pending={pending} onClick={() => { const data = new FormData(); data.set("fundId", fundId); data.set("issueId", issueId); setError(null); startTransition(async () => { const result = await acknowledgeIssueAction(data); if (!result.ok) { setError(result.error); return; } router.refresh(); }); }} /></div>;
}
