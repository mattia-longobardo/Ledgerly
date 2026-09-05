import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { EarningsTable } from "@/modules/payroll/ui/EarningsTable";
import { loadEarnings } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Earnings" };

/**
 * Gated on `caps.features.payroll`, matching `/company` and `/company/payroll`
 * (spec §4): with no document store configured, `loadEarnings` would otherwise
 * reach `runForPrincipal` and throw `DocumentStoreUnavailableError`, landing
 * the user on `company/error.tsx`'s generic failure screen instead of the
 * setup state its siblings show — even though earnings data is Postgres-only
 * and never touches the document store at all.
 */
export default async function EarningsPage() {
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

  // `EarningsTable` renders its own setup state when there are no records, so
  // a user with the feature on but nothing applied sees an explanation and a
  // link, not an empty table (spec §3.3).
  const { rows } = await loadEarnings();
  return (
    <>
      <PageHeader title="Earnings" />
      <div className="pt-6">
        <EarningsTable rows={rows} />
      </div>
    </>
  );
}
