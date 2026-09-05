import { PageHeader } from "@/components/layout/PageHeader";
import { EarningsTable } from "@/modules/payroll/ui/EarningsTable";
import { loadEarnings } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Earnings" };

export default async function EarningsPage() {
  await requirePrincipalOrRedirect();
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
