import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { payroll } from "@ledgerly/api-contract/payroll";
import { apiRead } from "@/platform/api-read";
import { foundOr404 } from "../found";
import { ReviewScreen } from "./review-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("review.title") };
}

/** Review payslip (spec §7.8): `GET /payroll/payslips/{id}` first, for its 404. */
export default async function ReviewPayslipPage({ params }: PageProps<"/payroll/[id]">) {
  const { id } = await params;
  await foundOr404(id, (payslip) => apiRead(payroll.getPayslip, { params: { id: payslip } }));
  return <ReviewScreen id={id} />;
}
