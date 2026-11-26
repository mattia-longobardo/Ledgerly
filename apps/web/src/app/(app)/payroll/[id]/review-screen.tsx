"use client";

// Review payslip (spec §7.8, design "Review parsed payslip"), read from `/api/v1` (rewrite plan R3):
// `GET /payroll/payslips/{id}`. A decision on a value shows the review the route answers.
import { useTranslations } from "next-intl";
import { payroll } from "@ledgerly/api-contract/payroll";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { registerHref, ReviewBody, usePayrollFormat } from "@/modules/payroll/client";

export function ReviewScreen({ id }: { id: string }) {
  const text = useTranslations("payroll");
  const read = useApi(payroll.getPayslip, { params: { id } });
  const format = usePayrollFormat();
  return (
    <Page title={text("review.title")} parent={{ href: registerHref(read.data?.payslip?.year), label: text("review.back") }}>
      <Loaded state={read}>{(view) => format && <ReviewBody view={view} format={format} />}</Loaded>
    </Page>
  );
}
