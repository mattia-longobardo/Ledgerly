"use client";

import { useState, type ReactNode } from "react";
import { MoneyValue } from "./MoneyValue";
import { Sheet } from "./Sheet";
import { cn } from "./cn";
import { formatEur } from "@/lib/format";

export interface SheetFormStep {
  id: string;
  /** Shown in the sheet header while this step is active. */
  title: string;
  content: ReactNode;
  /** Blocks Next / Confirm while false. */
  valid?: boolean;
  nextLabel?: string;
}

export interface SheetFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  steps: readonly SheetFormStep[];
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
  height?: number | "auto";
  /** Controlled step index; omit to let the sheet own it. */
  step?: number;
  onStepChange?: (step: number) => void;
}

export function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <span className="flex items-center gap-2">
      <span className="num text-caption text-fg-muted">
        {step + 1}/{total}
      </span>
      <span aria-hidden className="flex gap-1">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={cn(
              "h-1 w-5 rounded-md transition-colors duration-150 ease-out",
              i <= step ? "bg-accent" : "bg-border",
            )}
          />
        ))}
      </span>
    </span>
  );
}

export interface AmountFieldProps {
  value: string;
  onChange: (value: string) => void;
  max?: number | null;
  label?: string;
  hint?: string;
  className?: string;
}

const CHIPS: readonly { label: string; fraction: number; srLabel: string }[] = [
  { label: "¼", fraction: 0.25, srLabel: "One quarter" },
  { label: "½", fraction: 0.5, srLabel: "Half" },
  { label: "All", fraction: 1, srLabel: "All of it" },
];

/**
 * `inputMode="decimal"` rather than `type="number"`: it raises the numeric
 * keypad without the spinner, and the Italian comma decimal stays typable.
 */
export function AmountField({
  value,
  onChange,
  max = null,
  label = "Amount",
  hint,
  className,
}: AmountFieldProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <label className="flex flex-col gap-1.5">
        <span className="text-caption tracking-wide text-fg-muted uppercase">{label}</span>
        {/* The ring moves to the wrapper: the euro glyph and the field are one
            control, so outlining the input alone would ring half of it. */}
        <span className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus-ring">
          <span aria-hidden className="num text-display-sm text-fg-muted">
            €
          </span>
          <input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0,00"
            /* The field grows to the number instead of sitting at a width
               guessed for the longest amount anyone might type. */
            className="num min-h-14 min-w-0 flex-1 bg-transparent text-display-sm text-fg outline-none field-sizing-content placeholder:text-fg-muted"
          />
        </span>
      </label>
      {max !== null && (
        <div className="flex gap-1.5">
          {CHIPS.map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => onChange((max * chip.fraction).toFixed(2).replace(".", ","))}
              className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-border bg-surface text-body-sm font-medium text-fg"
            >
              <span aria-hidden>{chip.label}</span>
              <span className="sr-only">{`${chip.srLabel}, ${formatEur(max * chip.fraction)}`}</span>
            </button>
          ))}
        </div>
      )}
      {hint !== undefined && <p className="text-body-sm text-fg-muted">{hint}</p>}
    </div>
  );
}

export interface ConfirmRow {
  label: string;
  value: ReactNode;
}

/** The confirm step body: what is about to happen, and the resulting balance. */
export function ConfirmSummary({
  rows,
  resultLabel,
  resultValue,
}: {
  rows: readonly ConfirmRow[];
  resultLabel?: string;
  resultValue?: number | null;
}) {
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-11 items-center justify-between gap-4 hairline-b">
          <span className="text-body-sm text-fg-muted">{row.label}</span>
          <span className="num text-body text-fg">{row.value}</span>
        </div>
      ))}
      {resultValue !== undefined && (
        <div className="flex items-center justify-between gap-4 pt-4">
          <span className="text-body-sm text-fg-muted">{resultLabel ?? "Resulting balance"}</span>
          <MoneyValue value={resultValue} size="display-sm" />
        </div>
      )}
    </div>
  );
}

export function SheetForm({
  open,
  onOpenChange,
  title,
  steps,
  onSubmit,
  submitLabel = "Confirm",
  submitting = false,
  height = 0.6,
  step,
  onStepChange,
}: SheetFormProps) {
  const [internalStep, setInternalStep] = useState(0);
  const index = step ?? internalStep;
  const total = steps.length;
  const active = steps[index];
  const isLast = index === total - 1;
  const canAdvance = active?.valid !== false && !submitting;

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(total - 1, next));
    if (step === undefined) setInternalStep(clamped);
    onStepChange?.(clamped);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && step === undefined) setInternalStep(0);
        onOpenChange(next);
      }}
      title={active === undefined ? title : `${title} · ${active.title}`}
      height={height}
      headerRight={<StepIndicator step={index} total={total} />}
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (index === 0 ? onOpenChange(false) : goTo(index - 1))}
            disabled={submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
          >
            {index === 0 ? "Cancel" : "Back"}
          </button>
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => (isLast ? onSubmit() : goTo(index + 1))}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
          >
            {submitting && (
              <span
                aria-hidden
                className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
              />
            )}
            {isLast ? submitLabel : (active?.nextLabel ?? "Next")}
          </button>
        </div>
      }
    >
      <div role="group" aria-label={`Step ${index + 1} of ${total}: ${active?.title ?? ""}`}>
        {active?.content}
      </div>
    </Sheet>
  );
}
