"use client";

// What a year grants of each type with an allowance (R5g): days, and what the years before left over
// where no payslip prints it. One form, saved by the page's banner like the others.
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { Button } from "@ledgerly/ui/button";
import { CardFooter } from "@ledgerly/ui/card";
import { Field } from "@ledgerly/ui/field";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { saveTypeAllowanceAction } from "./calls";
import { DaysInput, ErrorLine, useSave, YearRow } from "./settings-forms";

/** One type with an allowance, and what is stated of it for the year. */
export interface TypeAllowance {
  typeId: string;
  name: string;
  /** As typed: empty is nothing stated. */
  days: string;
  carriedDays: string;
}

type Fields = Record<string, { days: string; carriedDays: string }>;

const fieldsOf = (rows: readonly TypeAllowance[]): Fields =>
  Object.fromEntries(rows.map((row) => [row.typeId, { days: row.days, carriedDays: row.carriedDays }]));

/**
 * The allowances of one year. The stepper changes the year through the URL; the page re-mounts this
 * form (keyed by the year), so a value typed for one year is never saved under another.
 */
export function TypeAllowanceForm({
  year,
  rows,
  previous,
  stepper,
}: {
  year: number;
  rows: TypeAllowance[];
  /** Last year's, of the same types, to start from; null when last year states none. */
  previous: TypeAllowance[] | null;
  stepper: ReactNode;
}) {
  const text = useTranslations("timeoff");
  const [fields, setFields] = useState(() => fieldsOf(rows));
  const { pending, error, save, formRef } = useSave(text("toasts.allowanceSaved"));
  const set = (typeId: string, key: "days" | "carriedDays") => (value: string) =>
    setFields((was) => ({ ...was, [typeId]: { ...was[typeId], [key]: value } }));

  function submit(event: FormEvent) {
    event.preventDefault();
    save(async () => {
      const results = await Promise.all(
        rows.map((row) => saveTypeAllowanceAction({ typeId: row.typeId, year, ...fields[row.typeId] })),
      );
      return results.find((result) => !result.ok) ?? { ok: true };
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
      <YearRow label={text("header.yearLabel")}>{stepper}</YearRow>
      {rows.map((row) => (
        <TypeFields
          key={row.typeId}
          name={row.name}
          value={fields[row.typeId]}
          onDays={set(row.typeId, "days")}
          onCarried={set(row.typeId, "carriedDays")}
        />
      ))}
      <p className="text-sm text-muted">{text("settings.allowance.carriedHint")}</p>
      <ErrorLine error={error} />
      {previous && (
        <CardFooter>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setFields((was) => ({ ...was, ...fieldsOf(previous) }))}
          >
            {text("settings.copyFrom", { year: year - 1 })}
          </Button>
        </CardFooter>
      )}
    </form>
  );
}

function TypeFields({
  name,
  value,
  onDays,
  onCarried,
}: {
  name: string;
  value: { days: string; carriedDays: string };
  onDays: (value: string) => void;
  onCarried: (value: string) => void;
}) {
  const text = useTranslations("timeoff");
  const id = useId();
  return (
    <div className={FIELD_GRID}>
      <Field label={text("settings.allowance.days", { name })} htmlFor={`${id}-days`}>
        <DaysInput id={`${id}-days`} value={value.days} onChange={onDays} />
      </Field>
      <Field label={text("settings.allowance.carried", { name })} htmlFor={`${id}-carried`}>
        <DaysInput id={`${id}-carried`} min="-400" value={value.carriedDays} onChange={onCarried} />
      </Field>
    </div>
  );
}
