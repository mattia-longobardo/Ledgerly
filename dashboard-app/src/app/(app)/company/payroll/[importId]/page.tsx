import { notFound } from "next/navigation";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { QueueNav } from "@/modules/payroll/ui/QueueNav";
import { ReviewForm } from "@/modules/payroll/ui/ReviewForm";
import { loadReview } from "@/modules/payroll/ui/load-payroll";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { formatMonth } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Review payslip" };

/**
 * Gated the same way `/company/payroll` itself is: `payroll.upload` or
 * `payroll.review`. Without this, `loadReview`'s own `payroll.read` check (via
 * `getImport`) was the only gate on this route, so a viewer could reach the
 * full review screen — writes and the PDF view stay correctly blocked
 * server-side either way, but that contradicted this route family's own
 * documented gate, and let a viewer follow the Overview's "Latest import"
 * link into a screen that looks writable.
 */
export default async function ReviewPayslipPage({ params }: { params: Promise<{ importId: string }> }) {
  const principal = await requirePrincipalOrRedirect();
  const mayReview = principal.permissions.has("payroll.upload") || principal.permissions.has("payroll.review");

  if (!mayReview) {
    return (
      <>
        <PageHeader title="Payroll" />
        <div className="max-w-xl pt-6">
          <EmptyState title="No access to payroll" description="Ask an administrator for the payroll role." />
        </div>
      </>
    );
  }

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
