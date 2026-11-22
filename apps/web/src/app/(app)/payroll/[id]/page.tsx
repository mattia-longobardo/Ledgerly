import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { payroll } from "@ledgerly/api-contract/payroll";
import { apiRead } from "@/platform/api-read";
import { ReviewScreen } from "./review-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("review.title") };
}

/**
 * Review payslip (spec §7.8). One read before the page is drawn, for the status of the answer: a
 * payslip that is not the person's is a 404, which only the server can give. It asks `/api/v1`
 * (`apiRead`). Everything the page shows comes from the screen.
 */
export default async function ReviewPayslipPage({ params }: PageProps<"/payroll/[id]">) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id) || !(await apiRead(payroll.getPayslip, { params: { id } }))) notFound();
  return <ReviewScreen id={id} />;
}
