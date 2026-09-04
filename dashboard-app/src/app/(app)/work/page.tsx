import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { cn } from "@/components/ui/cn";
import {
  averageNet,
  averageTaxes,
  leaveTakenYtd,
  netPerMonthSeries,
  ral,
} from "@/lib/calc/payroll";
import {
  formatDays,
  formatEur,
  formatMonth,
  formatNumber,
  hoursToDays,
} from "@/lib/format";
import { allPayslips, verifiedPayslips } from "@/lib/repo/payslips";
import { requireUserOrRedirect } from "@/lib/auth/require-user";
import { loadFerie } from "../_lib/vacation";
import { loadLeaveCalendar } from "./_lib/leave";
import { LeaveByMonth } from "./_components/LeaveByMonth";
import { LeaveCalendar } from "./_components/LeaveCalendar";
import { SalarySection, type SalaryWindow } from "./_components/SalarySection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Work" };

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  verified: { label: "verified", className: "bg-positive/10 text-positive" },
  parsed: { label: "needs review", className: "bg-warning/10 text-warning" },
  discovered: {
    label: "not parsed",
    className: "bg-surface text-fg-muted border border-border",
  },
  rejected: { label: "rejected", className: "bg-negative/10 text-negative" },
  superseded: {
    label: "superseded",
    className: "bg-surface text-fg-muted border border-border",
  },
};

export default async function WorkPage() {
  await requireUserOrRedirect("/work");

  const year = new Date().getFullYear();
  const [verified, payslips, ferie, calendar] = await Promise.all([
    verifiedPayslips(),
    allPayslips(),
    loadFerie(year),
    loadLeaveCalendar(year),
  ]);

  const windows: SalaryWindow[] = (["3", "6", "12"] as const).map((key) => {
    const months = Number(key);
    return {
      key,
      avgNet: averageNet(verified, months),
      avgTaxes: averageTaxes(verified, months),
      series: netPerMonthSeries(verified, `${months}M` as "3M" | "6M" | "12M"),
    };
  });

  const annual = ral(verified, year);
  const remaining = ferie.remaining;
  // Days ACTUALLY used, straight off the `ferie_taken` / `rol_taken` columns of
  // the verified payslips — payroll's own number, never a figure typed here.
  // The leave calendar below carries the other half, what was PLANNED, and the
  // two are reconciled per month rather than merged: only the payslip knows
  // what was booked, only the calendar knows which days, and a disagreement
  // between them is the thing worth showing.
  const taken = leaveTakenYtd(verified, year, ferie.hoursPerDay);
  const pending = payslips.filter((p) => p.status === "parsed");

  return (
    <>
      <PageHeader title="Work" eyebrow={`${year}`} />

      <PageGrid className="pt-5">
        {pending.length > 0 && (
          <Panel span={12} ariaLabel="Payslips waiting for verification">
            <Link
              href={`/work/verify/${pending[0]?.id ?? ""}`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-warning/10 px-4 py-3 transition-colors hover:bg-warning/15"
            >
              <span className="text-body-sm text-fg">
                {pending.length === 1
                  ? "1 payslip is waiting for verification"
                  : `${pending.length} payslips are waiting for verification`}
              </span>
              <span aria-hidden className="text-body-sm font-medium text-warning">
                Review &rarr;
              </span>
            </Link>
          </Panel>
        )}

        {/* The four figures that answer "where am I?". One cluster sharing its
            seams: 2x2 on a phone, 1x4 once the row is wide enough, with the
            remaining-days gauge lifted as the read this screen exists to give.
            The step is on the cluster's own width, not the viewport's. */}
        <Panel span={12} ariaLabel="Leave and salary at a glance">
          <StatGrid columns={4}>
            <StatTile
              label={`Days taken ${year}`}
              value={formatDays(taken.totalDays)}
              sub={
                <span className="num">
                  {`Ferie ${formatDays(taken.ferieDays)} · ROL ${formatDays(taken.rolDays)}`}
                </span>
              }
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
            <StatTile
              label="Avg net 3 m"
              value={<MoneyValue value={windows[0]?.avgNet ?? null} size="display-sm" cents="muted" />}
              sub="Tredicesima excluded"
            />
            <StatTile
              label="RAL"
              value={
                <MoneyValue
                  value={annual.isProjected ? (annual.projected ?? annual.ytdGross) : annual.ytdGross}
                  size="display-sm"
                  cents="muted"
                />
              }
              sub={
                annual.isProjected ? (
                  <span className="num text-warning">
                    Projected · YTD {formatEur(annual.ytdGross)}
                  </span>
                ) : (
                  "Gross, tredicesima included"
                )
              }
            />
          </StatGrid>

          <p className="num pt-2 text-caption text-fg-muted">
            Residuals from the latest verified payslip
            {remaining.permessiHours !== null &&
              ` · permessi ${formatNumber(remaining.permessiHours)} h (not in the headline)`}
            {" · "}
            <StaleBadge capturedAt={ferie.latest?.verifiedAt ?? null} stale={ferie.latest === null} />
          </p>
        </Panel>

        {/* The calendar is the wide half of the pair; the payslip-derived
            figures beside it are the narrow one. They are two views of the same
            year, so they belong on one row rather than stacked a screen apart. */}
        <LeaveCalendar view={calendar} />

        <LeaveByMonth
          months={ferie.takenByMonth}
          ytdDays={taken.totalDays}
          year={year}
          firstPendingId={pending[0]?.id ?? null}
          pendingCount={pending.length}
        />

        <SalarySection windows={windows} />

        <Panel span={7} title="Payslips">
          {payslips.length === 0 ? (
            <div className="max-w-xl">
              <EmptyState
                title="No payslips yet"
                description="Payslips arrive from Paperless as soon as one is tagged Payroll. Nothing here is entered by hand."
                action={
                  <Link
                    href="/settings/admin"
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                  >
                    Check the job runs
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="hairline-t">
              {payslips.map((payslip) => {
                const chip = STATUS_CHIP[payslip.status] ?? {
                  label: payslip.status,
                  className: "bg-surface text-fg-muted border border-border",
                };
                return (
                  <li key={payslip.id} className="lazy-block [contain-intrinsic-size:auto_4rem]">
                    <Link
                      href={`/work/verify/${payslip.id}`}
                      className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="num block text-body text-fg">
                          {formatMonth(payslip.month)}
                          {payslip.isThirteenth && (
                            <span className="ml-2 text-caption text-fg-muted">13ª</span>
                          )}
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 inline-flex rounded-xs px-1.5 py-0.5 text-caption",
                            chip.className,
                          )}
                        >
                          {chip.label}
                        </span>
                      </span>
                      <MoneyValue value={payslip.net} size="body" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}
