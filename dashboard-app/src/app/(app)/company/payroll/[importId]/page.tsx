import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { QueueNav } from "@/modules/payroll/ui/QueueNav";
import { ReviewForm } from "@/modules/payroll/ui/ReviewForm";
import { loadReview } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review payslip" };

export default async function ReviewPayslipPage({ params }: { params: Promise<{ importId: string }> }) {
  await requirePrincipalOrRedirect();
  const { importId } = await params;
  const review = await loadReview(importId);
  if (!review) notFound();

  return (
    <>
      <PageHeader title={review.month ? formatMonth(review.month) : review.import.fileName} eyebrow="Payroll" />
      <ReviewForm
        key={review.import.id}
        importId={review.import.id}
        month={review.month}
        monthLabel={review.month ? formatMonth(review.month) : review.import.fileName}
        isThirteenth={review.isThirteenth}
        status={review.import.status}
        version={review.version}
        fields={review.fields}
        checks={review.checks}
        pending={review.pending}
        nav={<QueueNav pending={review.pending} currentId={review.import.id} />}
      />
    </>
  );
}
