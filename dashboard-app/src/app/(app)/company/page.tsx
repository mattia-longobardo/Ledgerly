import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StatGrid, StatTile } from "@/components/ui/StatTile";
import { loadCompanyOverview } from "@/modules/payroll/ui/load-company";
import { statusChip } from "@/modules/payroll/ui/status";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";
import { SalarySection } from "@/modules/payroll/ui/SalarySection";

export const dynamic = "force-dynamic";
export const metadata = { title: "Company" };

/**
 * Spec §7.8: earnings, the latest import status and the alerts that go with it.
 * Time-off balances and upcoming leave join this panel in Phase 7 — this phase
 * relocates the leave calendar to `/company/time-off` without redesigning it
 * (Ruling R4-11).
 */
export default async function CompanyPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  // `/company/payroll/[importId]` is gated on `payroll.upload || payroll.review`
  // (matching `/company/payroll` itself); the "Latest import" link below must
  // agree, or a viewer with only `payroll.read` could follow it into the full
  // review screen the rest of this route family denies them.
  const mayReviewImport = caps.permissions.has("payroll.upload") || caps.permissions.has("payroll.review");

  if (!caps.features.payroll) {
    return (
      <>
        <PageHeader title="Company" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect a payroll document store"
            description="Company earnings are derived from uploaded payslips. Connect the document store to begin."
            action={
              <Link
                href="/settings/integrations/payroll_silo"
                className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
              >
                Go to Integrations
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const overview = await loadCompanyOverview();
  const year = new Date().getFullYear();

  return (
    <>
      <PageHeader title="Company" eyebrow={`${year}`} />
      <PageGrid className="pt-5">
        {overview.pendingReview > 0 && (
          <Panel span={12} ariaLabel="Payslips waiting for review">
            <Link
              href="/company/payroll"
              className="flex min-h-11 items-center justify-between gap-3 rounded-md border border-border bg-warning/10 px-4 py-3 transition-colors hover:bg-warning/15"
            >
              <span className="text-body-sm text-fg">
                {overview.pendingReview === 1
                  ? "1 payslip is waiting for review"
                  : `${overview.pendingReview} payslips are waiting for review`}
              </span>
              <span aria-hidden className="text-body-sm font-medium text-warning">
                Review &rarr;
              </span>
            </Link>
          </Panel>
        )}

        <Panel span={12} ariaLabel="Earnings at a glance">
          <StatGrid columns={4}>
            {/* Every tile renders an em dash, never a zero, when the figure is
                absent — `MoneyValue` already does that for `null`. */}
            <StatTile label={`Gross ${year}`} value={<MoneyValue value={overview.year?.gross ?? null} size="display-sm" cents="muted" />} sub="Applied payslips only" />
            <StatTile emphasis="primary" label={`Net ${year}`} value={<MoneyValue value={overview.year?.net ?? null} size="display-sm" cents="muted" />} sub="Applied payslips only" />
            <StatTile label={`Taxes ${year}`} value={<MoneyValue value={overview.year?.taxes ?? null} size="display-sm" cents="muted" />} sub="Total deductions" />
            <StatTile label={`Contributions ${year}`} value={<MoneyValue value={overview.year?.contributions ?? null} size="display-sm" cents="muted" />} sub="Employee and employer" />
          </StatGrid>
        </Panel>

        {overview.salaryWindows.length > 0 && <SalarySection windows={overview.salaryWindows} />}

        <Panel span={7} title="Latest import">
          {overview.latestImport === null ? (
            <div className="max-w-xl">
              <EmptyState
                title="No payslips yet"
                description="Upload a payslip and it will be scanned, read and put in front of you to confirm."
                action={
                  <Link
                    href="/company/payroll"
                    className="inline-flex min-h-11 items-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
                  >
                    Upload a payslip
                  </Link>
                }
              />
            </div>
          ) : mayReviewImport ? (
            <Link
              href={`/company/payroll/${overview.latestImport.id}`}
              className="flex min-h-11 items-center justify-between gap-3 py-2 transition-colors hover:bg-surface-hover"
            >
              <span className="text-body text-fg">{overview.latestImport.fileName}</span>
              <span className="text-body-sm text-fg-muted">
                {statusChip(overview.latestImport.status, overview.latestImport.scanStatus).label}
              </span>
            </Link>
          ) : (
            <div className="flex min-h-11 items-center justify-between gap-3 py-2">
              <span className="text-body text-fg">{overview.latestImport.fileName}</span>
              <span className="text-body-sm text-fg-muted">
                {statusChip(overview.latestImport.status, overview.latestImport.scanStatus).label}
              </span>
            </div>
          )}
        </Panel>
      </PageGrid>
    </>
  );
}
