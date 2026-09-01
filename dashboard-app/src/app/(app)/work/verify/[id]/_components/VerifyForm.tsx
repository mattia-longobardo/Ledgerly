"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition, type ReactNode } from "react";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/components/ui/cn";
import { confirmPayslip, rejectPayslip } from "@/app/actions/payslips";
import type { Confidence, SanityCheck } from "@/lib/contracts";
import { formatEur, formatNumber } from "@/lib/format";
import { successorOf, verifyHref, type QueueEntry } from "./queue";

export type VerifiableField =
  | "gross"
  | "net"
  | "taxes"
  | "fundContribEmployee"
  | "fundContribEmployer"
  | "ferieBalance"
  | "rolBalance"
  | "ferieTaken"
  | "rolTaken";

export interface VerifyField {
  name: VerifiableField;
  label: string;
  hint: string;
  unit: "eur" | "hours";
  /** Pre-filled from the confirmed column when there is one, else the extraction. */
  initial: string;
  confidence: Confidence;
  rules: number | null;
  llm: number | null;
}

export interface VerifyFormProps {
  payslipId: number;
  documentId: number;
  /** Raw month key; the queue is ordered by it. */
  month: string;
  monthLabel: string;
  isThirteenth: boolean;
  status: string;
  fields: readonly VerifyField[];
  checks: readonly SanityCheck[];
  /** Every payslip still waiting, current one included, as the page saw it. */
  pending: readonly QueueEntry[];
  /** Server-rendered queue bar; hidden once the run is over. */
  nav?: ReactNode;
}

const PEEK_OFFSET = "calc(3.5rem + env(safe-area-inset-bottom, 0px))";

function decimal(value: number | null, unit: "eur" | "hours"): string {
  if (value === null) return "—";
  return unit === "eur" ? formatEur(value) : `${formatNumber(value)} h`;
}

function toInput(value: number): string {
  return String(value).replace(".", ",");
}

function PdfFrame({ documentId, className }: { documentId: number; className?: string }) {
  return (
    <iframe
      src={`/api/paperless/preview/${documentId}`}
      title="Payslip PDF"
      className={cn("h-full w-full rounded-md border border-border bg-surface", className)}
    />
  );
}

/**
 * Form-first on mobile with the PDF one tap away; split view from 1024 px up.
 * Low-confidence fields are tinted and show BOTH candidates — the rules engine
 * and the LLM — so a disagreement is resolved with one tap instead of a squint
 * at the PDF.
 */
export function VerifyForm(props: VerifyFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(props.fields.map((f) => [f.name, f.initial])),
  );
  const [isThirteenth, setIsThirteenth] = useState(props.isThirteenth);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  // The persisted flag, never the checkbox: the queue must not reorder itself
  // under the cursor while the form is being edited.
  const currentEntry: QueueEntry = {
    id: props.payslipId,
    month: props.month,
    isThirteenth: props.isThirteenth,
  };

  /**
   * /work belongs to another screen, so the "nothing left" message is shown
   * here for a beat and the exit follows on its own.
   */
  useEffect(() => {
    if (!done) return;
    const timer = window.setTimeout(() => {
      router.push("/work");
      router.refresh();
    }, 2400);
    return () => window.clearTimeout(timer);
  }, [done, router]);

  function set(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  /**
   * Stay in the run: open the next payslip still waiting. `remaining` comes
   * from the server for a decision (confirm / reject) and from the page for a
   * skip, so a payslip handled in another tab is never handed back.
   */
  function advance(remaining: readonly QueueEntry[], decided: boolean) {
    const nextId = successorOf(remaining, currentEntry);
    if (nextId !== null) {
      router.push(verifyHref(nextId));
      router.refresh();
      return;
    }
    if (decided) {
      setDone(true);
      return;
    }
    router.push("/work");
  }

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await confirmPayslip({
        id: props.payslipId,
        gross: values.gross ?? null,
        net: values.net ?? null,
        taxes: values.taxes ?? null,
        fundContribEmployee: values.fundContribEmployee ?? null,
        fundContribEmployer: values.fundContribEmployer ?? null,
        ferieBalance: values.ferieBalance ?? null,
        rolBalance: values.rolBalance ?? null,
        ferieTaken: values.ferieTaken ?? null,
        rolTaken: values.rolTaken ?? null,
        isThirteenth,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      advance(result.data.pending, true);
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectPayslip(props.payslipId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      advance(result.data.pending, true);
    });
  }

  /** Leaves the payslip pending and moves on; nothing is written. */
  function skip() {
    setError(null);
    advance(props.pending, false);
  }

  if (done) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 px-4 py-16 text-center"
      >
        <span aria-hidden className="text-display-sm text-positive">
          ✓
        </span>
        <h2 className="text-heading text-fg">Every payslip is verified</h2>
        <p className="text-body-sm text-fg-muted">Nothing is left in the queue. Back to Work…</p>
        <button
          type="button"
          onClick={() => {
            router.push("/work");
            router.refresh();
          }}
          className="mt-2 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg"
        >
          Go now
        </button>
      </section>
    );
  }

  return (
    <div className="lg:grid lg:grid-cols-[55fr_45fr] lg:gap-6 lg:px-4">
      {/* Desktop only: the PDF holds the left 55 %. */}
      <div className="hidden lg:block">
        <div className="sticky top-4 h-[calc(100dvh-6rem)]">
          <PdfFrame documentId={props.documentId} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col">
        {props.nav}

        {props.checks.length > 0 && (
          <section className="px-4 pt-4 lg:px-0">
            <h2 className="text-caption tracking-wide text-fg-muted uppercase">Computed checks</h2>
            <ul className="mt-2 flex flex-col gap-1.5">
              {props.checks.map((check) => (
                <li
                  key={check.id}
                  className={cn(
                    "flex items-start gap-2 rounded-xs px-2 py-1.5 text-body-sm",
                    check.passed ? "text-fg-muted" : "bg-warning/10 text-warning",
                  )}
                >
                  <span aria-hidden className="font-semibold">
                    {check.passed ? "✓" : "!"}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-fg">{check.label}</span>
                    {check.detail !== undefined && (
                      <span className="num block text-caption">{check.detail}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {error !== null && (
          <div className="px-4 pt-4 lg:px-0">
            <ErrorInline message={error} onRetry={confirm} />
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
          className="mt-4 flex flex-col gap-4 px-4 lg:px-0"
        >
          {props.fields.map((field) => {
            const low = field.confidence === "low";
            const medium = field.confidence === "medium";
            const candidates: { source: string; value: number | null }[] = [
              { source: "Rules", value: field.rules },
              { source: "LLM", value: field.llm },
            ];
            const showCandidates =
              low ||
              (field.rules !== null &&
                field.llm !== null &&
                Math.abs(field.rules - field.llm) >= 0.005);

            return (
              <div
                key={field.name}
                className={cn(
                  "flex flex-col gap-1.5 rounded-md px-3 py-2",
                  low && "bg-warning/10",
                  medium && "bg-surface",
                )}
              >
                <label className="flex flex-col gap-1.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-caption tracking-wide text-fg-muted uppercase">
                      {field.label}
                    </span>
                    <span
                      className={cn(
                        "text-caption",
                        low ? "text-warning" : medium ? "text-fg-muted" : "text-positive",
                      )}
                    >
                      {field.confidence} confidence
                    </span>
                  </span>
                  <input
                    value={values[field.name] ?? ""}
                    onChange={(event) => set(field.name, event.target.value)}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="—"
                    className="num min-h-11 rounded-md border border-border bg-surface px-3 text-body text-fg"
                  />
                </label>
                <span className="text-caption text-fg-muted">{field.hint}</span>

                {showCandidates && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {candidates.map((candidate) => (
                      <button
                        key={candidate.source}
                        type="button"
                        disabled={candidate.value === null}
                        onClick={() =>
                          candidate.value !== null && set(field.name, toInput(candidate.value))
                        }
                        className="num inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body-sm text-fg disabled:opacity-40"
                      >
                        <span className="text-caption text-fg-muted">{candidate.source}</span>
                        {decimal(candidate.value, field.unit)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <label className="flex min-h-11 items-center gap-3 px-3">
            <input
              type="checkbox"
              checked={isThirteenth}
              onChange={(event) => setIsThirteenth(event.target.checked)}
              className="size-5 accent-accent"
            />
            <span className="text-body text-fg">
              This is the tredicesima
              <span className="block text-caption text-fg-muted">
                Excluded from monthly averages, included in annual totals and Cometa deposits.
              </span>
            </span>
          </label>

          {props.status !== "rejected" && (
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-negative disabled:opacity-40"
            >
              Reject this payslip
            </button>
          )}

          {/* Peek bar + actions ride together above the tab bar on mobile. */}
          <div
            className="sticky z-20 -mx-4 mt-2 bg-surface hairline-t lg:static lg:mx-0 lg:bg-transparent"
            style={{ bottom: PEEK_OFFSET }}
          >
            <button
              type="button"
              onClick={() => setPdfOpen(true)}
              className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left hairline-b lg:hidden"
            >
              <span aria-hidden className="text-body-sm font-semibold text-fg-muted">
                PDF
              </span>
              <span className="min-w-0 flex-1 truncate text-body-sm text-fg">
                {props.monthLabel} payslip
              </span>
              <span aria-hidden className="text-body-sm text-accent">
                Open
              </span>
            </button>

            <div className="safe-b flex gap-2 px-4 py-3 lg:px-0">
              <button
                type="submit"
                disabled={pending}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
              >
                {pending && (
                  <span
                    aria-hidden
                    className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
                  />
                )}
                Confirm &amp; save
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
              >
                Mark unresolved
              </button>
            </div>
          </div>
        </form>
      </div>

      <Sheet
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        title={`${props.monthLabel} payslip`}
        height={0.6}
        className="lg:hidden"
      >
        <div className="h-full min-h-80">
          <PdfFrame documentId={props.documentId} />
        </div>
      </Sheet>
    </div>
  );
}
