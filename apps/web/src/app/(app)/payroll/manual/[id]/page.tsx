import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { manual } from "@ledgerly/api-contract/payroll";
import { apiRead } from "@/platform/api-read";
import { foundOr404 } from "../../found";
import { ManualScreen } from "./manual-screen";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("payroll"))("manual.title") };
}

/** A payslip typed by hand (R5g, ST-21): `GET /payroll/manual-payslips/{id}` first, for its 404. */
export default async function ManualPayslipPage({ params }: PageProps<"/payroll/manual/[id]">) {
  const { id } = await params;
  await foundOr404(id, (payslip) => apiRead(manual.getManualPayslip, { params: { id: payslip } }));
  return <ManualScreen id={id} />;
}
