import Link from "next/link";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { ImportsTable } from "@/modules/payroll/ui/ImportsTable";
import { UploadForm } from "@/modules/payroll/ui/UploadForm";
import { loadImports } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { realProbes } from "@/platform/capabilities/probes";
import { resolveCapabilities } from "@/platform/capabilities/resolve";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payroll" };

/**
 * Spec §4 gates this page on `payroll.upload` or `payroll.review`. With no
 * document store configured it shows the setup state and a link to Settings ›
 * Integrations — never an empty table that looks like "you have no payslips".
 */
export default async function PayrollPage() {
  const principal = await requirePrincipalOrRedirect();
  const caps = await resolveCapabilities(principal, realProbes);
  const mayUse = caps.permissions.has("payroll.upload") || caps.permissions.has("payroll.review");

  if (!mayUse) {
    return (
      <>
        <PageHeader title="Payroll" />
        <div className="max-w-xl pt-6">
          <EmptyState title="No access to payroll" description="Ask an administrator for the payroll role." />
        </div>
      </>
    );
  }

  if (!caps.features.payroll) {
    return (
      <>
        <PageHeader title="Payroll" />
        <div className="max-w-xl pt-6">
          <EmptyState
            title="Connect a payroll document store"
            description="Payslips are stored outside the database. Connect the document store to start uploading."
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

  const rows = await loadImports();

  return (
    <>
      <PageHeader title="Payroll" />
      <div className="flex flex-col gap-8 pt-6">
        <ImportsTable rows={rows} />
        {caps.permissions.has("payroll.upload") && (
          <div className="max-w-md hairline-t pt-8">
            <h2 className="text-body-sm font-medium text-fg-muted">Upload a payslip</h2>
            <div className="pt-4">
              <UploadForm />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
