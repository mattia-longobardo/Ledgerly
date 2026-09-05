"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { Sheet } from "@/components/ui/Sheet";
import { cn } from "@/components/ui/cn";
import { applyPayslipAction, rejectPayslipAction, verifyPayslipAction } from "@/app/actions/payroll";
import { PAYSLIP_FIELDS, type PayslipField, type SanityCheck } from "@/lib/contracts";
import { formatEur, formatNumber } from "@/lib/format";
import type { ReviewField } from "./load-payroll";
import { reviewHref, successorOf, type QueueEntry } from "./queue";

export interface ReviewFormProps {
  importId: string;
  version: number;
  /** Raw month key; the queue is ordered by it. */
  month: string;
  monthLabel: string;
  isThirteenth: boolean;
  status: string;
  fields: readonly ReviewField[];
  checks: readonly SanityCheck[];
  /** Every import still waiting, current one included, as the page saw it. */
  pending: readonly QueueEntry[];
  /** Server-rendered queue bar; hidden once the run is over. */
  nav?: ReactNode;
}

const PEEK_OFFSET = "calc(3.5rem + env(safe-area-inset-bottom, 0px))";

function decimal(value: number | null, unit: "eur" | "hours"): string {
  if (value === null) return "-";
  return unit === "eur" ? formatEur(value) : `${formatNumber(value)} h`;
}

/** A plain dot decimal, matching what `verifyImport`'s `DECIMAL_RE` accepts — never a localised comma. */
function toInput(value: number): string {
  return String(value);
}

function PdfFrame({ importId, className }: { importId: string; className?: string }) {
  return (
    <iframe
      src={`/api/v1/payroll/imports/${importId}/original`}
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
export function ReviewForm(props: ReviewFormProps) {
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
    id: props.importId,
    month: props.month,
    isThirteenth: props.isThirteenth,
  };

  function set(name: string, value: string) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  function goTo(nextId: string | null, decided: boolean) {
    if (nextId !== null) {
      router.push(reviewHref(nextId));
      router.refresh();
      return;
    }
    if (decided) {
      setDone(true);
      return;
    }
    router.push("/company/payroll");
  }

  /**
   * Stay in the run: open the next payslip still waiting. `remaining` comes
   * from the server for a decision (apply / reject) and from the page for a
   * skip, so a payslip handled in another tab is never handed back.
   */
  function advance(remaining: readonly QueueEntry[], decided: boolean) {
    goTo(successorOf(remaining, currentEntry), decided);
  }

  function collectValues(): Record<PayslipField, string | null> {
    const result = {} as Record<PayslipField, string | null>;
    for (const field of PAYSLIP_FIELDS) {
      const raw = (values[field] ?? "").trim();
      result[field] = raw === "" ? null : raw;
    }
    return result;
  }

  /** Confirms the figures; the import becomes `verified` and the reviewer stays put. */
  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await verifyPayslipAction({
        id: props.importId,
        version: props.version,
        month: props.month,
        isThirteenth,
        values: collectValues(),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Refetches this route's server data, which hands this component a
      // fresh `version` and `status: "verified"` — the loop the queue's own
      // "another tab" rule already relies on.
      router.refresh();
    });
  }

  /** Only once verified: turns the import into money and advances the run. */
  function apply() {
    setError(null);
    startTransition(async () => {
      const result = await applyPayslipAction({ id: props.importId });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Server-computed, not `props.pending`: that snapshot is from this
      // page's last render, and another reviewer could have resolved a
      // different import in the meantime.
      goTo(result.data.next, true);
    });
  }

  function reject() {
    setError(null);
    startTransition(async () => {
      const result = await rejectPayslipAction({ id: props.importId, version: props.version });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      goTo(result.data.next, true);
    });
  }

  /** Leaves the payslip pending and moves on; nothing is written. */
  function skip() {
    setError(null);
    advance(props.pending, false);
  }

  const canApply = props.status === "verified";
  const canReject = props.status !== "rejected" && props.status !== "applied" && props.status !== "superseded";

  if (done) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="flex flex-col items-center gap-3 py-16 text-center"
      >
        <span aria-hidden className="text-display-sm text-positive">
          ✓
        </span>
        <h2 className="text-heading text-fg">Every payslip is reviewed</h2>
        <p className="text-body-sm text-fg-muted">Nothing is left in the queue.</p>
        <button
          type="button"
          onClick={() => {
            router.push("/company/payroll");
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
    <PageGrid className="pt-5">
      {/*
        Desktop only: the PDF holds seven of twelve columns and stays put while
        the form scrolls beside it. This screen is the clearest case for the
        wider shell — the source document and the fields that transcribe it used
        to fight over one 896 px column, so verifying meant scrolling between
        them.
      */}
      <Panel span={7} ariaLabel="Payslip document" className="hidden lg:block">
        <div className="sticky top-4 h-[calc(100dvh-7rem)]">
          <PdfFrame importId={props.importId} />
        </div>
      </Panel>

      <Panel span={5} ariaLabel="Review fields">
        {props.nav}

        {props.checks.length > 0 && (
          <section className="pt-4">
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
          <div className="pt-4">
            <ErrorInline message={error} onRetry={confirm} />
          </div>
        )}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            confirm();
          }}
          className="mt-4 flex flex-col gap-4"
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
                    placeholder="-"
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
                        className="num inline-flex min-h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-body-sm text-fg transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:bg-bg disabled:text-fg-muted"
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

          {canReject && (
            <button
              type="button"
              onClick={reject}
              disabled={pending}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-negative disabled:opacity-40"
            >
              Reject
            </button>
          )}

          {/* Peek bar + actions ride together above the tab bar on mobile. */}
          <div
            className="sticky z-20 mt-2 bg-surface hairline-t [margin-inline:calc(-1*var(--axis-bleed))] lg:static lg:mx-0 lg:bg-transparent"
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

            <div className="safe-b flex flex-wrap gap-2 px-4 py-3 lg:px-0">
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
                Confirm
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={pending || !canApply}
                title={canApply ? undefined : "Confirm the figures first."}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={skip}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40"
              >
                Skip
              </button>
            </div>
          </div>
        </form>
      </Panel>

      <Sheet
        open={pdfOpen}
        onOpenChange={setPdfOpen}
        title={`${props.monthLabel} payslip`}
        height={0.6}
        className="lg:hidden"
      >
        <div className="h-full min-h-80">
          <PdfFrame importId={props.importId} />
        </div>
      </Sheet>
    </PageGrid>
  );
}
