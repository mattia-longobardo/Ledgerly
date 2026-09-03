"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { recordBalanceAction } from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SheetForm, type SheetFormStep } from "@/components/ui/SheetForm";
import { cn } from "@/components/ui/cn";

export interface BalanceFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  /** Server's civil today (Europe/Rome), not the browser's — a future date is refused. */
  today: string;
  onSaved?: () => void;
}

const FIELD =
  "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

/** Manual accounts only: a synced account's balances come from the provider. */
export function BalanceForm({
  open,
  onOpenChange,
  accountId,
  today,
  onSaved,
}: BalanceFormProps) {
  const router = useRouter();
  const [asOf, setAsOf] = useState(today);
  const [balance, setBalance] = useState("");
  const [available, setAvailable] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const valid = asOf !== "" && balance.trim() !== "";

  function submit() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", accountId);
      formData.set("asOf", asOf);
      formData.set("balance", balance);
      if (available.trim() !== "") formData.set("available", available);

      const result = await recordBalanceAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setBalance("");
      setAvailable("");
      onOpenChange(false);
      router.refresh();
      onSaved?.();
    });
  }

  const step: SheetFormStep = {
    id: "balance",
    title: "Record balance",
    valid,
    content: (
      <div className="flex flex-col gap-4">
        {error !== null && <ErrorInline message={error} />}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Date</span>
          <input
            type="date"
            value={asOf}
            max={today}
            onChange={(event) => setAsOf(event.target.value)}
            className={cn(FIELD, "num")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Balance</span>
          <input
            value={balance}
            onChange={(event) => setBalance(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            className={cn(FIELD, "num")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Available (optional)</span>
          <input
            value={available}
            onChange={(event) => setAvailable(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            className={cn(FIELD, "num")}
          />
        </label>
      </div>
    ),
  };

  return (
    <SheetForm
      open={open}
      onOpenChange={onOpenChange}
      title="Record balance"
      steps={[step]}
      onSubmit={submit}
      submitLabel="Record"
      submitting={pending}
    />
  );
}
