"use client";

// Payroll › Settings › the employer (R5g, E6): how often it pays, and the month of each extra
// payment. The yearly gross of the register expects every extra payment listed here.
import { useTranslations } from "next-intl";
import { employer as employerRoutes, MAX_EXTRA_PAYMENTS, PAY_FREQUENCIES } from "@ledgerly/api-contract/payroll";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsSection } from "@ledgerly/ui/section";
import { Field } from "@ledgerly/ui/field";
import { Select } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { saveEmployerAction } from "../manual-calls";
import { kindLabel } from "./labels";
import { monthName } from "./manual-dialog";
import { usePayrollFormat } from "./format";
import type { Employer } from "./present";

const MONTHS = [...Array(12).keys()].map((index) => index + 1);
const COUNTS = [...Array(MAX_EXTRA_PAYMENTS + 1).keys()];
/** The month proposed for a new extra payment: December, then June, then July. */
const PROPOSED = [12, 6, 7];

/** How many extra payments, then the month of each. */
function ExtraMonths({ months, onChange, locale }: { months: number[]; onChange: (months: number[]) => void; locale: string }) {
  const text = useTranslations("payroll");
  const id = useId();
  const setCount = (count: number) => onChange(COUNTS.slice(1, count + 1).map((number) => months[number - 1] ?? PROPOSED[number - 1] ?? 12));
  const setMonth = (index: number, month: number) => onChange(months.map((one, place) => (place === index ? month : one)));
  return (
    <>
      <Field label={text("employer.extras")} htmlFor={`${id}-extras`}>
        <Select id={`${id}-extras`} value={String(months.length)} onChange={(event) => setCount(Number(event.target.value))}>
          {COUNTS.map((count) => (
            <option key={count} value={count}>
              {count === 0 ? text("employer.none") : count}
            </option>
          ))}
        </Select>
      </Field>
      {months.map((month, index) => (
        <Field
          key={index}
          label={text("employer.extraMonth", { kind: kindLabel(text, { kind: "extra", extraNumber: index + 1 }) })}
          htmlFor={`${id}-month-${index}`}
        >
          <Select id={`${id}-month-${index}`} value={String(month)} onChange={(event) => setMonth(index, Number(event.target.value))}>
            {MONTHS.map((number) => (
              <option key={number} value={number}>
                {monthName(number, locale)}
              </option>
            ))}
          </Select>
        </Field>
      ))}
    </>
  );
}

function EmployerCard({ employer, locale }: { employer: Employer; locale: string }) {
  const text = useTranslations("payroll.employer");
  const id = useId();
  const [months, setMonths] = useState(employer.extraMonths);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const frequency = String(new FormData(event.currentTarget).get("frequency") ?? "");
    startTransition(async () => {
      const result = await saveEmployerAction(frequency, months);
      setError(result.ok ? null : text("failed"));
      if (result.ok) notify(text("saved"));
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3" data-testid="employer">
      {!employer.configured && <p className="text-sm text-muted">{text("notConfigured")}</p>}
      <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Field label={text("frequency")} htmlFor={`${id}-frequency`}>
          <Select id={`${id}-frequency`} name="frequency" defaultValue={employer.payFrequency}>
            {PAY_FREQUENCIES.map((frequency) => (
              <option key={frequency} value={frequency}>
                {text(`frequencies.${frequency}`)}
              </option>
            ))}
          </Select>
        </Field>
        <ExtraMonths months={months} onChange={setMonths} locale={locale} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-neg">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {text("save")}
        </Button>
      </div>
    </form>
  );
}

/** The section of Payroll › Settings, with its own read of `GET /payroll/employer`. */
export function EmployerSection() {
  const text = useTranslations("payroll.employer");
  const read = useApi(employerRoutes.getPayrollEmployer, {});
  const format = usePayrollFormat();
  return (
    <SettingsSection title={text("title")} description={text("description")}>
      <Loaded state={read}>{(view) => format && <EmployerCard employer={view} locale={format.locale} />}</Loaded>
    </SettingsSection>
  );
}
