"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Panel } from "@/components/layout/PageGrid";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { MonthGrid } from "@/components/ui/MonthGrid";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Sheet } from "@/components/ui/Sheet";
import { Toast } from "@/components/ui/Toast";
import { cn } from "@/components/ui/cn";
import { removeLeaveDay, setLeaveDay, syncLeaveNow } from "@/app/actions/leave";
import { isWeekendBlocked, type LeaveFraction, type LeaveKind } from "@/lib/calc/leave-day";
import type { LeaveMonthVariance } from "@/lib/calc/leave-variance";
import { formatDays, formatMonth, formatNumber } from "@/lib/format";
import type { LeaveCalendarView } from "../_lib/leave";

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-surface px-4 text-body-sm font-medium text-fg disabled:opacity-40";
const DANGER =
  "inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-negative/5 px-4 text-body-sm font-medium text-negative disabled:opacity-40";
const LABEL = "text-caption tracking-wide text-fg-muted uppercase";

function Spinner() {
  return (
    <span
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-accent-contrast/40 border-t-accent-contrast"
    />
  );
}

const FRACTION_OPTIONS = [
  { value: "1" as const, label: "Full day" },
  { value: "0.5" as const, label: "Half day" },
];

const KIND_OPTIONS = [
  { value: "vacation" as const, label: "Ferie", srLabel: "Vacation" },
  { value: "comp" as const, label: "Recupero", srLabel: "Comp time" },
];

interface Editing {
  date: string;
  fraction: "1" | "0.5";
  kind: LeaveKind;
  exists: boolean;
}

/** The variance line the owner actually reads: "took 1 day more than planned". */
function varianceSentence(v: LeaveMonthVariance): string {
  const delta = Math.abs(v.deltaDays ?? 0);
  const direction = v.status === "over" ? "more than" : "fewer than";
  return `${formatMonth(v.month)}: ${formatDays(v.actualDays)} on the payslip, ${direction} the ${formatDays(v.plannedDays)} on the calendar (${formatNumber(delta)} d out).`;
}

export interface LeaveCalendarProps {
  view: LeaveCalendarView;
}

/**
 * The leave calendar: a 12-month vertical list of dot grids, each expandable
 * into an editable day grid. Tapping any day opens the editor sheet, so booking
 * a new day and changing an existing one are the same gesture.
 *
 * Half days are a first-class choice everywhere, because Trek's `fraction` is
 * exactly 1 or 0.5 and nothing in between — the control offers those two and
 * only those two.
 */
export function LeaveCalendar({ view }: LeaveCalendarProps) {
  const router = useRouter();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function openDay(iso: string) {
    const existing = view.byDate[iso];
    setError(null);
    setEditing({
      date: iso,
      // An existing day opens on its own values, so re-saving it unchanged is a
      // no-op rather than a silent conversion. A new day defaults to a full
      // ferie day, which is what almost every booking is.
      fraction: existing?.fraction === 0.5 ? "0.5" : "1",
      kind: existing?.kind ?? "vacation",
      exists: existing !== undefined,
    });
  }

  function finish(message: string) {
    setEditing(null);
    setToast(message);
    router.refresh();
  }

  function save() {
    if (editing === null) return;
    setError(null);
    const input = {
      date: editing.date,
      fraction: Number(editing.fraction) as LeaveFraction,
      kind: editing.kind,
    };
    startTransition(async () => {
      const result = await setLeaveDay(input);
      if (result.ok) finish(result.data.message);
      else setError(result.error);
    });
  }

  function remove() {
    if (editing === null) return;
    setError(null);
    const date = editing.date;
    startTransition(async () => {
      const result = await removeLeaveDay({ date });
      if (result.ok) finish(result.data.message);
      else setError(result.error);
    });
  }

  function sync() {
    setError(null);
    startTransition(async () => {
      const result = await syncLeaveNow({ year: view.year });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const s = result.data;
      setToast(
        s.status === "disabled"
          ? "Trek sync is off: no credential is configured."
          : // Nothing ran: the hourly pass owns the sync right now. Saying
            // "0 in, 0 out" would read as "Trek has no news", which is a
            // different and wrong statement.
            s.status === "skipped"
            ? "A sync is already running. It will finish in a moment."
            : `Synced with Trek · ${s.pulled} in, ${s.pushed} out`,
      );
      router.refresh();
    });
  }

  const stats = view.cachedStats?.stats ?? null;

  return (
    <Panel
      span={7}
      title="Leave calendar"
      action={
        <button type="button" onClick={sync} disabled={pending} className={SECONDARY}>
          {pending && (
            <span
              aria-hidden
              className="mr-2 size-4 animate-spin rounded-full border-2 border-border border-t-fg"
            />
          )}
          {pending ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      {!view.configured && (
        <p className="pt-1 text-body-sm text-fg-muted">
          Trek sync is off: no credential is configured. Days edited here are saved on the
          dashboard and will be sent to Trek as soon as one is.
        </p>
      )}

      {error !== null && (
        <div className="pt-2">
          <ErrorInline message={error} />
        </div>
      )}

      {/* Trek's own figures, shown rather than recomputed: it already honours
          the configured leave-year window and carry-over, neither of which this
          app models. The payslip residual sits beside them instead of being
          silently reconciled into one number. */}
      {stats !== null && (
        <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
          {[
            { label: "Allowance", value: stats.totalAvailable },
            { label: "Used", value: stats.used },
            { label: "Remaining", value: stats.remaining },
          ].map((tile) => (
            <div key={tile.label} className="flex flex-col gap-1 bg-surface p-3">
              <span className="text-caption tracking-wide text-fg-muted uppercase">
                {tile.label}
              </span>
              <span className="num text-body text-fg">{formatDays(tile.value)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="num pt-2 text-caption text-fg-muted">
        {`${formatDays(view.plannedDaysYtd)} on the calendar in ${view.year}`}
        {stats !== null && ` · Trek counts ${formatDays(stats.used)} used, ${formatDays(stats.compUsed)} comp`}
        {view.pendingCount > 0 && ` · ${view.pendingCount} waiting to reach Trek`}
      </p>

      {/* Requirement 4: a month planned for X days that ended up more or fewer. */}
      {view.flagged.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2">
          {view.flagged.map((v) => (
            <li
              key={v.month}
              className="flex items-start gap-3 rounded-md border border-border bg-warning/10 px-4 py-3"
            >
              <span aria-hidden className="text-body font-semibold text-warning">
                !
              </span>
              <span className="min-w-0 flex-1 text-body-sm text-fg">{varianceSentence(v)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Twelve month grids is the one genuinely heavy list in the app. Each
          month renders only once it is near the viewport, with its height
          reserved so nothing jumps. */}
      <div className="mt-3 hairline-t">
        {view.months.map((m) => (
          <MonthGrid
            key={m.month}
            month={m.month}
            days={m.days}
            onSelectDay={openDay}
            // Trek's plan blocks weekends, so offering them would only produce a
            // refusal. Greyed out rather than hidden: the grid must stay a real
            // calendar.
            isDaySelectable={(iso) => !isWeekendBlocked(iso)}
          />
        ))}
      </div>

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-3 text-caption text-fg-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full bg-accent" /> taken
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-full border border-accent bg-accent/25" />
          planned
        </span>
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2.5 overflow-hidden rounded-full border border-accent"
          >
            <span className="block h-full w-1/2 bg-accent" />
          </span>
          half day
        </span>
      </p>

      <Sheet
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        title={editing === null ? "Leave" : editing.date}
        description="Trek stores whole and half days only. There is no morning or afternoon."
        height="auto"
        footer={
          <div className="flex gap-2">
            {editing?.exists === true && (
              <button type="button" onClick={remove} disabled={pending} className={DANGER}>
                Remove
              </button>
            )}
            <button type="button" onClick={save} disabled={pending} className={cn(PRIMARY, "flex-1")}>
              {pending && <Spinner />}
              {editing?.exists === true ? "Save" : "Book this day"}
            </button>
          </div>
        }
      >
        {editing !== null && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Length</span>
              <SegmentedControl
                label="Length"
                options={FRACTION_OPTIONS}
                value={editing.fraction}
                onChange={(fraction) => setEditing({ ...editing, fraction })}
                fullWidth
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={LABEL}>Type</span>
              <SegmentedControl
                label="Type"
                options={KIND_OPTIONS}
                value={editing.kind}
                onChange={(kind) => setEditing({ ...editing, kind })}
                fullWidth
              />
            </div>
            <p className="text-body-sm text-fg-muted">
              {view.configured
                ? "Saved here and pushed to Trek straight away."
                : "Saved here. Trek sync is off, so it stays on the dashboard for now."}
            </p>
          </div>
        )}
      </Sheet>

      <Toast
        open={toast !== null}
        message={toast ?? ""}
        duration={4000}
        onOpenChange={(open) => {
          if (!open) setToast(null);
        }}
      />
    </Panel>
  );
}
