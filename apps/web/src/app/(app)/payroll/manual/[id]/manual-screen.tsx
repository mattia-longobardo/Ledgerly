"use client";

// A payslip typed by hand (R5g, ST-21), read from `GET /payroll/manual-payslips/{id}` and the
// catalogue of fields.
import { useTranslations } from "next-intl";
import { employer, manual } from "@ledgerly/api-contract/payroll";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { ManualView, usePayrollFormat } from "@/modules/payroll/client";

export function ManualScreen({ id }: { id: string }) {
  const text = useTranslations("payroll.manual");
  const read = useApi(manual.getManualPayslip, { params: { id } });
  const fields = useApi(employer.listPayslipFields, {}).data;
  const format = usePayrollFormat();
  return (
    <Page title={text("title")} parent={{ href: "/payroll", label: text("back") }}>
      <Loaded state={read}>
        {(payslip) => format && fields && <ManualView payslip={payslip} catalogue={fields.fields} format={format} />}
      </Loaded>
    </Page>
  );
}
