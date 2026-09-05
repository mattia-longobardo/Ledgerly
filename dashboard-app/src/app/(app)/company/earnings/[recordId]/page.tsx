import Link from "next/link";
import { notFound } from "next/navigation";
import { PageGrid } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatMonth } from "@/lib/format";
import { RecordDetail } from "@/modules/payroll/ui/RecordDetail";
import { loadRecordDetail } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";

/**
 * Mirrors the page body's own first two calls, in the same order: without
 * this, an unauthenticated hit or one with no document store configured would
 * rely on `loadRecordDetail`'s transitive `runForPrincipal` to reject, which
 * throws `DocumentStoreUnavailableError` rather than redirecting or falling
 * back to a generic title the way the gated body renders a setup state.
 */
export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }) {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  if (!caps.features.payroll) return { title: "Earnings" };
  const { recordId } = await params;
  const detail = await loadRecordDetail(recordId);
  return { title: detail ? formatMonth(detail.record.periodStart) : "Earnings" };
}

/**
 * Gated on `caps.features.payroll`, matching `/company/earnings` and
 * `/company/payroll` (spec §4): with no document store configured,
 * `loadRecordDetail` would otherwise throw `DocumentStoreUnavailableError`
 * through to `company/error.tsx`'s generic failure screen — even though this
 * record is Postgres-only and never touches the document store at all.
 */
export default async function EarningsRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);

  if (!caps.features.payroll) {
    return (
      <>
        <PageHeader title="Earnings" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect a payroll document store"
            description="Earnings are derived from uploaded payslips. Connect the document store to begin."
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

  const { recordId } = await params;
  const detail = await loadRecordDetail(recordId);
  if (!detail) notFound();

  return (
    <>
      <PageHeader title={formatMonth(detail.record.periodStart)} eyebrow="Earnings" />
      <PageGrid className="pt-5">
        <RecordDetail detail={detail} />
      </PageGrid>
    </>
  );
}
