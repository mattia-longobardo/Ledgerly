import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { leaveTakenYtd } from "@/lib/calc/payroll";
import { formatDays, formatNumber, hoursToDays } from "@/lib/format";
import { verifiedPayslips } from "@/lib/repo/payslips";
import { loadImports } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { loadFerie } from "../../_lib/vacation";
import { LeaveByMonth } from "../_components/LeaveByMonth";
import { LeaveCalendar } from "../_components/LeaveCalendar";
import { loadLeaveCalendar } from "../_lib/leave";

export const dynamic = "force-dynamic";
export const metadata = { title: "Time Off" };

/**
 * Ruling R4-11: the leave half of the retired `/work` page, relocated to the
 * route spec §4 gives it. Not the Phase 7 workspace — no in-place detail panel,
 * no balances by type, no URL-driven day selection. Those arrive with
 * `timeoff_types`/`timeoff_balances`/`timeoff_events`.
 *
 * `loadFerie` and `verifiedPayslips` still read the legacy `payslips` table,
 * unchanged: Phase 7 replaces that source, and moving the read in this phase
 * would mean deriving balances from `payroll_components` with no
 * `timeoff_balances` table to put them in.
 */
export default async function TimeOffPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  const year = new Date().getFullYear();
  // Spec §4 makes this page reachable with **Trek alone** — payroll off, no
  // document store connected. `loadImports` goes through `runForPrincipal`,
  // which throws `DocumentStoreUnavailableError` when there is no store, so it
  // is asked for only when the payroll feature is actually on. Without this
  // guard a Trek-only user gets a stack trace instead of their calendar.
  const [verified, ferie, calendar, imports] = await Promise.all([
    verifiedPayslips(),
    loadFerie(year),
    loadLeaveCalendar(year),
    caps.features.payroll ? loadImports() : Promise.resolve([]),
  ]);

  const remaining = ferie.remaining;
  // Days ACTUALLY used, straight off the `ferie_taken` / `rol_taken` columns of
  // the verified payslips — payroll's own number, never a figure typed here.
  // The leave calendar below carries the other half, what was PLANNED, and the
  // two are reconciled per month rather than merged.
  const taken = leaveTakenYtd(verified, year, ferie.hoursPerDay);
  const pending = imports.filter((i) => i.status === "needs_review" || i.status === "needs_ocr");

  return (
    <>
      <PageHeader title="Time Off" eyebrow={`${year}`} />
      <PageGrid className="pt-5">
        <Panel span={12} ariaLabel="Leave at a glance">
          <StatGrid columns={2}>
            <StatTile
              label={`Days taken ${year}`}
              value={formatDays(taken.totalDays)}
              sub={<span className="num">{`Ferie ${formatDays(taken.ferieDays)} · ROL ${formatDays(taken.rolDays)}`}</span>}
            />
            <StatTile
              emphasis="primary"
              label="Days remaining"
              value={remaining.combinedDays === null ? "-" : formatDays(remaining.combinedDays)}
              sub={
                <span className="num">
                  {`Ferie ${formatDays(hoursToDays(remaining.ferieHours, ferie.hoursPerDay))} · ROL ${formatDays(hoursToDays(remaining.rolHours, ferie.hoursPerDay))}`}
                </span>
              }
            />
          </StatGrid>
          <p className="num pt-2 text-caption text-fg-muted">
            Residuals from the latest verified payslip
            {remaining.permessiHours !== null && ` · permessi ${formatNumber(remaining.permessiHours)} h (not in the headline)`}
            {" · "}
            <StaleBadge capturedAt={ferie.latest?.verifiedAt ?? null} stale={ferie.latest === null} />
          </p>
        </Panel>

        <LeaveCalendar view={calendar} />

        <LeaveByMonth
          months={ferie.takenByMonth}
          ytdDays={taken.totalDays}
          year={year}
          firstPendingId={pending[0]?.id ?? null}
          pendingCount={pending.length}
        />
      </PageGrid>
    </>
  );
}
