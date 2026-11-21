import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { reviewView } from "@ledgerly/domain/payroll";
import { requireSession } from "@/platform/auth/session";
import { ReviewScreen } from "./review-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("review.title") };
}

/**
 * Review payslip (spec §7.8). M10: one necessary server read, the status of the answer — a payslip
 * that is not the person's is a 404, which only a server read can give before the page is drawn, as
 * on a rule's and a pocket's page (decision A). Everything the page shows comes from `/api/v1`.
 */
export default async function ReviewPayslipPage({ params }: PageProps<"/payroll/[id]">) {
  const ctx = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await reviewView(ctx, id))) notFound();
  return <ReviewScreen id={id} />;
}
