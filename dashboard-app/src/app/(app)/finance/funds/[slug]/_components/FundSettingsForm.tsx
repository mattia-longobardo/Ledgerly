"use client";

import { useState, useTransition } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Toast } from "@/components/ui/Toast";
import { recordManualDeposit, saveFundSettings } from "@/app/actions/funds";
import { cn } from "@/components/ui/cn";

export interface FundSettingsFormProps {
  fundId: number;
  fundName: string;
  effectiveFrom: string;
  initialCapital: string;
  depositMode: "fixed" | "payroll";
  fixedMonthlyAmount: string;
  currentMonth: string;
}

const FIELD =
  "num min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

export function FundSettingsForm(props: FundSettingsFormProps) {
  const [effectiveFrom, setEffectiveFrom] = useState(props.effectiveFrom);
  const [initialCapital, setInitialCapital] = useState(props.initialCapital);
  const [mode, setMode] = useState<"fixed" | "payroll">(props.depositMode);
  const [fixed, setFixed] = useState(props.fixedMonthlyAmount);

  const [depositMonth, setDepositMonth] = useState(props.currentMonth);
  const [depositAmount, setDepositAmount] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submitSettings() {
    setError(null);
    startTransition(async () => {
      const result = await saveFundSettings({
        fundId: props.fundId,
        effectiveFrom,
        initialCapital,
        depositMode: mode,
        fixedMonthlyAmount: mode === "fixed" ? fixed : null,
      });
      if (result.ok) setToast("Settings saved");
      else setError(result.error);
    });
  }

  function submitDeposit() {
    setError(null);
    startTransition(async () => {
      const result = await recordManualDeposit({
        fundId: props.fundId,
        month: depositMonth,
        amount: depositAmount,
      });
      if (result.ok) {
        setDepositAmount("");
        setToast("Deposit recorded");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {error !== null && <ErrorInline message={error} onRetry={submitSettings} />}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitSettings();
        }}
        className="flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Initial capital</span>
          <input
            value={initialCapital}
            onChange={(e) => setInitialCapital(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            className={FIELD}
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className={LABEL}>Deposits</legend>
          <div className="flex gap-2">
            {(["fixed", "payroll"] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => setMode(option)}
                className={cn(
                  "inline-flex min-h-11 flex-1 items-center justify-center rounded-md border px-3 text-body-sm font-medium",
                  mode === option
                    ? "border-accent bg-accent text-accent-contrast"
                    : "border-border bg-surface text-fg-muted",
                )}
              >
                {option === "fixed" ? "Fixed monthly amount" : "Link to payroll"}
              </button>
            ))}
          </div>
          <p className="text-body-sm text-fg-muted">
            {mode === "fixed"
              ? "A fixed amount is booked every month."
              : "Deposits come from the verified payslip's contributions — employee plus employer."}
          </p>
        </fieldset>

        {mode === "fixed" && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Fixed monthly amount</span>
            <input
              value={fixed}
              onChange={(e) => setFixed(e.target.value)}
              inputMode="decimal"
              autoComplete="off"
              placeholder="0,00"
              className={FIELD}
            />
          </label>
        )}

        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Effective from</span>
          <input
            type="month"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className={FIELD}
          />
          <span className="text-body-sm text-fg-muted">
            Saving writes a new effective-dated row. Earlier months keep the settings they were
            booked under.
          </span>
        </label>

        <button
          type="submit"
          disabled={pending}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
        >
          {pending && (
            <span
              aria-hidden
              className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
            />
          )}
          Save settings
        </button>
      </form>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitDeposit();
        }}
        className="flex flex-col gap-3 hairline-t pt-4"
      >
        <span className={LABEL}>Manual deposit</span>
        <div className="flex gap-2">
          <input
            type="month"
            value={depositMonth}
            onChange={(e) => setDepositMonth(e.target.value)}
            aria-label="Deposit month"
            className={cn(FIELD, "flex-1")}
          />
          <input
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            aria-label="Deposit amount"
            className={cn(FIELD, "flex-1")}
          />
        </div>
        <button
          type="submit"
          disabled={pending || depositAmount.trim() === ""}
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
        >
          Record deposit
        </button>
      </form>

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        detail={props.fundName}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
        duration={4000}
      />
    </div>
  );
}
