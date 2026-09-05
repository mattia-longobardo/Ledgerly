import { notFound } from "next/navigation";
import { PageGrid } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { formatMonth } from "@/lib/format";
import { RecordDetail } from "@/modules/payroll/ui/RecordDetail";
import { loadRecordDetail } from "@/modules/payroll/ui/load-company";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = await params;
  const detail = await loadRecordDetail(recordId);
  return { title: detail ? formatMonth(detail.record.periodStart) : "Earnings" };
}

export default async function EarningsRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  await requirePrincipalOrRedirect();
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
