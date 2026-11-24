"use client";

// A payslip typed by hand (R5g, ST-21): its kind and month — or which extra payment it is —, the four
// base amounts, the catalogue's other fields and an optional PDF. It is applied at once.
import { useTranslations } from "next-intl";
import { type FormEvent, useId, useState, useTransition } from "react";
import { Field } from "@ledgerly/ui/field";
import { FormDialog } from "@ledgerly/ui/form-dialog";
import { Input, InputGroup, Select } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { MAX_EXTRA_PAYMENTS, type ManualInput, PAYSLIP_KINDS, saveManualPayslipAction } from "../manual-calls";
import { kindLabel, useFieldLabel } from "./labels";
import { type Catalogue, type Format, hoursOf, type ManualPayslip } from "./present";

/** 1…n. */
const upTo = (count: number) => [...Array(count).keys()].map((index) => index + 1);
const MONTHS = upTo(12);
// shortcut: `conflict` is read as "the month already has a payslip" because the route gives the same
// reason to a concurrent write; use the route's own reason once it has one.
const ERROR_KEYS = {
  conflict: "errors.conflict",
  invalid_value: "errors.invalid_value",
  invalid: "errors.invalid",
  invalid_state: "errors.invalid_state",
  not_found: "errors.not_found",
} as const;
const errorKey = (code: string) =>
  Object.entries(ERROR_KEYS).find(([known]) => known === code)?.[1] ?? "errors.failed";
const AMOUNTS = ["gross", "taxes", "contributions", "net"] as const;
type Amount = (typeof AMOUNTS)[number];

/** The name of a month in the person's language. */
export function monthName(month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(Date.UTC(2000, month - 1, 1));
}

/** What the fields start from, written the way the person types it. */
interface Draft extends ManualInput {
  hasDocument: boolean;
}

function draftOf(payslip: ManualPayslip | null, format: Format): Draft {
  const typed = (value: string | null) => (value === null ? "" : hoursOf(value, format));
  if (!payslip) {
    const blank = { gross: "", taxes: "", contributions: "", net: "", month: "", extraNumber: "1", paidOn: "" };
    return { ...blank, kind: "ordinary", year: String(new Date().getFullYear()), fields: {}, hasDocument: false };
  }
  return {
    kind: payslip.kind,
    year: String(payslip.year),
    month: payslip.period ? String(Number(payslip.period.slice(5, 7))) : "",
    extraNumber: String(payslip.extraNumber ?? 1),
    paidOn: payslip.paidOn ?? "",
    gross: typed(payslip.gross),
    taxes: typed(payslip.taxes),
    contributions: typed(payslip.contributions),
    net: typed(payslip.net),
    fields: Object.fromEntries(Object.entries(payslip.fields).map(([key, value]) => [key, typed(value)])),
    hasDocument: payslip.document !== null,
  };
}

/** What the form holds, as the calls take it. */
function inputOf(data: FormData, catalogue: Catalogue): ManualInput {
  const value = (key: string) => String(data.get(key) ?? "");
  const others = catalogue.filter((field) => !field.base);
  return {
    kind: value("kind"),
    year: value("year"),
    month: value("month"),
    extraNumber: value("extraNumber"),
    paidOn: value("paidOn"),
    gross: value("gross"),
    taxes: value("taxes"),
    contributions: value("contributions"),
    net: value("net"),
    fields: Object.fromEntries(others.map((field) => [field.key, value(`field-${field.key}`)])),
  };
}

function useSave(id: string | null, catalogue: Catalogue, onSaved: (id: string) => void) {
  const text = useTranslations("payroll.manual");
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const pdf = data.get("pdf");
    const file = pdf instanceof File && pdf.size > 0 ? pdf : null;
    setReading(file !== null);
    startTransition(async () => {
      const result = await saveManualPayslipAction(id, inputOf(data, catalogue), file);
      setReading(false);
      if (!result.ok) {
        setError(text(errorKey(result.error)));
        return;
      }
      notify(text("saved"));
      onSaved(result.id);
    });
  }
  return { onSubmit, error, reading, pending };
}

/** The kind, the year, and the month or the number of the extra payment. */
function KindFields({ draft, locale }: { draft: Draft; locale: string }) {
  const text = useTranslations("payroll");
  const id = useId();
  const [kind, setKind] = useState(draft.kind);
  const extra = kind === "extra";
  return (
    <>
      <Field label={text("manual.kind")} htmlFor={`${id}-kind`}>
        <Select id={`${id}-kind`} name="kind" value={kind} onChange={(event) => setKind(event.target.value)}>
          {PAYSLIP_KINDS.map((one) => (
            <option key={one} value={one}>
              {text(`manual.kinds.${one}`)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={text("manual.year")} htmlFor={`${id}-year`}>
        <Input id={`${id}-year`} name="year" type="number" min={1990} max={2200} step={1} numeric required defaultValue={draft.year} />
      </Field>
      <Field label={text(extra ? "manual.extraNumber" : "manual.month")} htmlFor={`${id}-when`}>
        {extra ? (
          <Select id={`${id}-when`} name="extraNumber" defaultValue={draft.extraNumber}>
            {upTo(MAX_EXTRA_PAYMENTS).map((number) => (
              <option key={number} value={number}>
                {kindLabel(text, { kind: "extra", extraNumber: number })}
              </option>
            ))}
          </Select>
        ) : (
          <Select id={`${id}-when`} name="month" defaultValue={draft.month}>
            {kind !== "ordinary" && <option value="">{text("manual.noMonth")}</option>}
            {MONTHS.map((number) => (
              <option key={number} value={number}>
                {monthName(number, locale)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

function AmountField({ name, label, value, required }: { name: string; label: string; value: string; required: boolean }) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <InputGroup suffix="€">
        <Input id={id} name={name} inputMode="decimal" numeric required={required} defaultValue={value} />
      </InputGroup>
    </Field>
  );
}

/** The catalogue's fields beyond the four base ones, folded unless the payslip has some. */
function OtherFields({ catalogue, draft }: { catalogue: Catalogue; draft: Draft }) {
  const text = useTranslations("payroll.manual");
  const label = useFieldLabel();
  const others = catalogue.filter((field) => !field.base);
  if (others.length === 0) return null;
  return (
    <details className="col-span-full flex flex-col" open={Object.keys(draft.fields).length > 0 || undefined}>
      <summary className="focus-ring inline-flex min-h-6 cursor-default items-center rounded-sm text-sm font-medium text-muted">
        {text("more")}
      </summary>
      <div className="mt-2 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
        {others.map((field) => (
          <AmountField
            key={field.key}
            name={`field-${field.key}`}
            label={label(field.key)}
            value={draft.fields[field.key] ?? ""}
            required={false}
          />
        ))}
      </div>
    </details>
  );
}

export function ManualDialog({
  payslip,
  catalogue,
  format,
  onClose,
  onSaved,
}: {
  /** Null: a new one. */
  payslip: ManualPayslip | null;
  catalogue: Catalogue;
  format: Format;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const text = useTranslations("payroll.manual");
  const id = useId();
  const draft = draftOf(payslip, format);
  const save = useSave(payslip?.id ?? null, catalogue, onSaved);
  const amount = (name: Amount) => (
    <AmountField key={name} name={name} label={text(name)} value={draft[name]} required />
  );

  return (
    <FormDialog
      onClose={onClose}
      title={text(payslip ? "editTitle" : "newTitle")}
      description={text("description")}
      width={520}
      onSubmit={save.onSubmit}
      error={save.error}
      pending={save.pending}
      cancelLabel={text("cancel")}
      submitLabel={text(save.reading ? "reading" : "save")}
      className="grid grid-cols-2 gap-3 max-sm:grid-cols-1"
    >
      <KindFields draft={draft} locale={format.locale} />
      <Field label={text("paidOn")} htmlFor={`${id}-paid`}>
        <Input id={`${id}-paid`} name="paidOn" type="date" defaultValue={draft.paidOn} />
      </Field>
      {AMOUNTS.map(amount)}
      <OtherFields catalogue={catalogue} draft={draft} />
      {!draft.hasDocument && (
        <div className="col-span-full">
          <Field label={text("pdf")} htmlFor={`${id}-pdf`} hint={text("pdfHint")}>
            <Input id={`${id}-pdf`} name="pdf" type="file" accept="application/pdf" className="py-1" />
          </Field>
        </div>
      )}
    </FormDialog>
  );
}
