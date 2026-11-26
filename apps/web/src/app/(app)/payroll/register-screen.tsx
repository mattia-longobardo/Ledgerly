"use client";

// Payroll (spec §7.8 "Registro", D13), read from `/api/v1` (rewrite plan R3): the register of one
// year's payslips — one card as tall as the window — under a compact strip of the year's KPIs. The
// year is in the URL (`?year=`), chosen with the stepper of Time off; without one it is the year
// running, even before its first payslip (owner's choice, 26/11/2026). Every figure is a field of
// `GET /payroll/payslips`; the screen formats it. While a document is read, the register reads its
// route again (audit UI-PAY-1).
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { employer, payroll } from "@ledgerly/api-contract/payroll";
import { today } from "@ledgerly/format/dates";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi, usePolling } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { parseYearQuery } from "@ledgerly/ui/period";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { YearPicker } from "@ledgerly/ui/year-picker";
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
  registerHref,
  usePayrollFormat,
} from "@/modules/payroll/client";

const FOLLOWED = [payroll.getPayroll];

function AddButtons({ size }: { size?: "md" }) {
  const text = useTranslations("payroll");
  return (
    <>
      <AddManualPayslip size={size} />
      <AddPayslips label={size ? text("empty.cta") : text("add")} size={size} />
    </>
  );
}

function RegisterBody({
  view,
  year,
  format,
  catalogue,
}: {
  view: Register;
  year: number;
  format: Format;
  catalogue: Catalogue;
}) {
  const text = useTranslations("payroll");
  usePolling(view.inFlight, FOLLOWED);
  const chosen = view.years.find((one) => one.year === year);
  const groups = chosen ? registerGroups([chosen], format) : [];
  const latest = view.years[0]?.year;
  // Nothing at all yet: the empty state offers the buttons itself.
  const blank = view.years.length === 0 && view.inbox.length === 0;
  return (
    <>
      <RegisterHeader view={view} year={chosen} format={format} />
      {/* On a phone the topbar holds the year only: the buttons sit under the title. */}
      {!blank && (
        <div className="flex gap-2 md:hidden">
          <AddButtons />
        </div>
      )}
      <PayrollTabs active="register" />
      {chosen && <RegisterKpis year={chosen} format={format} />}
      <RegisterInbox view={view} format={format} />
      {chosen ? (
        <RegisterTable groups={groups} catalogue={catalogue} />
      ) : blank ? (
        <EmptyState
          title={text("empty.title")}
          description={text("empty.description")}
          actions={<AddButtons size="md" />}
        />
      ) : (
        <EmptyState
          title={text("emptyYear.title", { year })}
          description={text("emptyYear.description")}
          actions={
            latest !== undefined && (
              <ButtonLink href={registerHref(latest)} size="md">
                {text("emptyYear.latest", { year: latest })}
              </ButtonLink>
            )
          }
        />
      )}
    </>
  );
}

export function RegisterScreen() {
  const text = useTranslations("payroll");
  const query = useSearchParams();
  const read = useApi(payroll.getPayroll, {});
  const fields = useApi(employer.listPayslipFields, {});
  const format = usePayrollFormat();
  const currentYear = format ? Number(today(format.timeZone).slice(0, 4)) : null;
  const years = read.data?.years.map((one) => one.year) ?? [];
  // A payslip dated after this year (a test's, a typo) can still be walked to.
  const lastYear = currentYear === null ? null : Math.max(currentYear, ...years);
  const year =
    currentYear === null || lastYear === null || !read.data
      ? null
      : parseYearQuery(query.get("year"), currentYear, lastYear);
  return (
    <Page
      title={text("title")}
      actions={
        <>
          {year !== null && currentYear !== null && lastYear !== null && (
            <YearPicker
              year={year}
              years={years}
              currentYear={currentYear}
              lastYear={lastYear}
              hrefFor={registerHref}
              labels={{
                label: text("year.label"),
                previous: text("year.previous"),
                next: text("year.next"),
                today: text("year.thisYear"),
              }}
            />
          )}
          <div className="flex items-center gap-2 max-md:hidden">
            <AddButtons />
          </div>
        </>
      }
    >
      <Loaded state={read}>
        {(view) =>
          format &&
          year !== null &&
          fields.data && <RegisterBody view={view} year={year} format={format} catalogue={fields.data.fields} />
        }
      </Loaded>
    </Page>
  );
}
