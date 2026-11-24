"use client";

// Payroll (spec §7.8 "Registro", D13), read from `/api/v1` (rewrite plan R3): the register of
// payslips — one card as tall as the window, grouped by year — under a compact strip of KPIs over the
// applied ordinary payslips. One "Add payslip", in the topbar. Every figure is a field of
// `GET /payroll/payslips`; the screen formats it. While a document is read, the register reads its
// route again (audit UI-PAY-1).
import { useTranslations } from "next-intl";
import { employer, payroll } from "@ledgerly/api-contract/payroll";
import { useApi, usePolling } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import {
  AddManualPayslip,
  AddPayslips,
  type Catalogue,
  type Format,
  PayrollTabs,
  type Register,
  RegisterHeader,
  RegisterInbox,
  RegisterKpis,
  RegisterTable,
  registerGroups,
  usePayrollFormat,
} from "@/modules/payroll/client";

const FOLLOWED = [payroll.getPayroll];

function RegisterBody({ view, format, catalogue }: { view: Register; format: Format; catalogue: Catalogue }) {
  const text = useTranslations("payroll");
  usePolling(view.inFlight, FOLLOWED);
  const groups = registerGroups(view.years, format);
  return (
    <>
      <RegisterHeader view={view} format={format} />
      <PayrollTabs active="register" />
      {groups.length === 0 && view.inbox.length === 0 ? (
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={
            <>
              <AddPayslips label={text("empty.cta")} size="md" />
              <AddManualPayslip size="md" />
            </>
          }
        />
      ) : (
        <>
          <RegisterKpis view={view} format={format} />
          <RegisterInbox view={view} format={format} />
          {groups.length > 0 && <RegisterTable groups={groups} catalogue={catalogue} />}
        </>
      )}
    </>
  );
}

export function RegisterScreen() {
  const text = useTranslations("payroll");
  const read = useApi(payroll.getPayroll, {});
  const fields = useApi(employer.listPayslipFields, {});
  const format = usePayrollFormat();
  return (
    <Page
      title={text("title")}
      actions={
        <>
          <AddManualPayslip />
          <AddPayslips label={text("add")} />
        </>
      }
    >
      <Loaded state={read}>
        {(view) =>
          format &&
          fields.data && <RegisterBody view={view} format={format} catalogue={fields.data.fields} />
        }
      </Loaded>
    </Page>
  );
}
