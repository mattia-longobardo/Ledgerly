"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { AmountField, ConfirmSummary, SheetForm, type SheetFormStep } from "@/components/ui/SheetForm";
import { Toast } from "@/components/ui/Toast";
import { recordWithdrawal, undoWithdrawal } from "@/app/actions/vacation";
import { parseMoney } from "@/app/actions/types";
import { formatEur } from "@/lib/format";

export interface WithdrawalFlowProps {
  balance: number;
  /** `YYYY-MM-DD` in Europe/Rome — the server's civil today, not the browser's. */
  today: string;
}

const UNDO_MS = 10_000;

/**
 * Three steps: amount → optional label and date → confirm with the resulting
 * balance. The success toast holds a 10 s Undo, which deletes the ledger row.
 */
export function WithdrawalFlow({ balance, today }: WithdrawalFlowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [occurredOn, setOccurredOn] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [undoId, setUndoId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();

  const parsed = parseMoney(amount);
  const valid = parsed !== null && parsed > 0;
  const resulting = valid ? balance - parsed : balance;

  function reset() {
    setAmount("");
    setNote("");
    setOccurredOn(today);
    setStep(0);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const result = await recordWithdrawal({
        amount,
        note: note.trim() === "" ? null : note.trim(),
        occurredOn,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      reset();
      setUndoId(result.data.entryId);
      router.refresh();
    });
  }

  function undo() {
    const id = undoId;
    if (id === null) return;
    setUndoId(null);
    startTransition(async () => {
      const result = await undoWithdrawal(id);
      if (!result.ok) setError(result.error);
      router.refresh();
    });
  }

  const steps: readonly SheetFormStep[] = [
    {
      id: "amount",
      title: "Amount",
      valid,
      content: (
        <AmountField
          value={amount}
          onChange={setAmount}
          max={balance > 0 ? balance : null}
          hint={`Available: ${formatEur(balance)}. This is a tracked note only — the app never writes to your Wallet account, so move the money out of Revolut Savings yourself.`}
        />
      ),
    },
    {
      id: "details",
      title: "Details",
      content: (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">
              Label (optional)
            </span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              autoComplete="off"
              placeholder="Flights to Lisbon"
              className="min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-caption tracking-wide text-fg-muted uppercase">Date</span>
            <input
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
              className="num min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
            />
          </label>
        </div>
      ),
    },
    {
      id: "confirm",
      title: "Confirm",
      content: (
        <div className="flex flex-col gap-4">
          <ConfirmSummary
            rows={[
              { label: "Withdrawal", value: formatEur(parsed ?? 0) },
              { label: "Label", value: note.trim() === "" ? "—" : note.trim() },
              { label: "Date", value: occurredOn },
            ]}
            resultValue={resulting}
          />
          <p className="text-body-sm text-fg-muted">
            Recorded as an annotation only. Nothing is sent to the Wallet API — make the matching
            transfer out of the Revolut Savings sub-account by hand.
          </p>
        </div>
      ),
    },
  ];

  return (
    <>
      {error !== null && (
        <div className="px-4 pb-3">
          <ErrorInline message={error} />
        </div>
      )}

      <div className="px-4">
        <button
          type="button"
          onClick={() => {
            reset();
            setError(null);
            setOpen(true);
          }}
          className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"
        >
          Record withdrawal
        </button>
      </div>

      <SheetForm
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        title="Withdrawal"
        steps={steps}
        step={step}
        onStepChange={setStep}
        onSubmit={submit}
        submitLabel="Record"
        submitting={pending}
      />

      <Toast
        open={undoId !== null}
        message="Withdrawal recorded"
        detail="Tracked annotation only — no Wallet write."
        duration={UNDO_MS}
        onUndo={undo}
        onOpenChange={(next) => {
          if (!next) setUndoId(null);
        }}
      />
    </>
  );
}
