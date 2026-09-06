"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createBudgetAction, updateBudgetAction } from "@/app/actions/budgets";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { SheetForm, type SheetFormStep } from "@/components/ui/SheetForm";
import type { Budget } from "../application/ports";
import { PERIOD_KINDS } from "../application/validation";

const FIELD = "min-h-11 w-full rounded-md border border-border bg-surface px-3 text-body text-fg";
const FIELD_NARROW = `${FIELD} num max-w-48`;
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

function label(value: string): string {
  return value.replace(/^./, (letter) => letter.toUpperCase());
}

export function BudgetForm({
  open,
  onOpenChange,
  budget,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  budget?: Budget;
}) {
  const router = useRouter();
  const editing = budget !== undefined;
  const [name, setName] = useState(budget?.name ?? "");
  const [description, setDescription] = useState(budget?.description ?? "");
  const [currency, setCurrency] = useState(budget?.currency ?? "EUR");
  const [periodKind, setPeriodKind] = useState(budget?.periodKind ?? "monthly");
  const [startDate, setStartDate] = useState(budget?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(budget?.endDate ?? "");
  const [goalAmount, setGoalAmount] = useState(budget?.goalAmount?.replace(".", ",") ?? "");
  const [labels, setLabels] = useState(budget?.labels.join(", ") ?? "");
  const [initialAmount, setInitialAmount] = useState("");
  const [status, setStatus] = useState(budget?.status ?? "active");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("name", name);
      data.set("description", description);
      data.set("periodKind", periodKind);
      data.set("startDate", startDate);
      data.set("endDate", endDate);
      data.set("goalAmount", goalAmount);
      data.set("labels", labels);
      if (budget) {
        data.set("id", budget.id);
        data.set("version", String(budget.version));
        data.set("status", status);
      } else {
        data.set("currency", currency.toUpperCase());
        data.set("initialAmount", initialAmount);
      }
      const result = budget ? await updateBudgetAction(data) : await createBudgetAction(data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
    });
  }

  const step: SheetFormStep = {
    id: "details",
    title: "Details",
    valid:
      name.trim() !== "" &&
      startDate.trim() !== "" &&
      (editing || (currency.trim().length === 3 && initialAmount.trim() !== "")),
    content: (
      <div className="flex flex-col gap-4">
        {error && <ErrorInline message={error} />}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Description (optional)</span>
          <input value={description} onChange={(event) => setDescription(event.target.value)} autoComplete="off" className={FIELD} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Period</span>
          <select value={periodKind} onChange={(event) => setPeriodKind(event.target.value as Budget["periodKind"])} className={FIELD}>
            {PERIOD_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {label(kind)}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3 @xl:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Start date</span>
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className={FIELD_NARROW} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>End date (optional)</span>
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className={FIELD_NARROW} />
          </label>
        </div>
        {!editing && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Currency</span>
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={3} className={`${FIELD} num uppercase max-w-24`} />
          </label>
        )}
        {!editing && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Opening amount</span>
            <input value={initialAmount} onChange={(event) => setInitialAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" className={FIELD_NARROW} />
          </label>
        )}
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Goal amount (optional)</span>
          <input value={goalAmount} onChange={(event) => setGoalAmount(event.target.value)} inputMode="decimal" autoComplete="off" placeholder="0,00" className={FIELD_NARROW} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={LABEL}>Labels (comma-separated, optional)</span>
          <input value={labels} onChange={(event) => setLabels(event.target.value)} autoComplete="off" className={FIELD} />
        </label>
        {editing && (
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value as Budget["status"])} className={FIELD}>
              <option value="active">Active</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
      </div>
    ),
  };

  return (
    <SheetForm
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit budget" : "New budget"}
      steps={[step]}
      onSubmit={submit}
      submitLabel={editing ? "Save" : "Create budget"}
      submitting={pending}
    />
  );
}

export function BudgetFormTrigger({
  budget,
  label: triggerLabel,
  className,
}: {
  budget?: Budget;
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={className ?? "inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast"}
      >
        {triggerLabel ?? (budget ? "Edit budget" : "New budget")}
      </button>
      <BudgetForm open={open} onOpenChange={setOpen} budget={budget} />
    </>
  );
}
