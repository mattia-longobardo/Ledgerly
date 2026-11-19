// The fields of «a value at a date» (audit UI-ACC-5): the day, the amount and a note, as a balance of
// an account and a valuation of a fund are recorded. The words and the names are the caller's; what
// a module asks besides the three goes between the amount and the note.
import type { ReactNode } from "react";
import { Field } from "./field";
import { Input } from "./input";

export function ValueEntryFields({
  idPrefix,
  today,
  labels,
  valueName,
  initial,
  autoFocus = false,
  children,
}: {
  idPrefix: string;
  /** The last day a value can be recorded for. */
  today: string;
  labels: { date: string; value: string; note: string };
  /** The form's name of the amount. */
  valueName: string;
  initial?: { on?: string; value?: string; note?: string | null };
  autoFocus?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <Field label={labels.date} htmlFor={`${idPrefix}-on`}>
        <Input
          id={`${idPrefix}-on`}
          name="on"
          type="date"
          max={today}
          defaultValue={initial?.on ?? today}
          required
        />
      </Field>
      <Field label={labels.value} htmlFor={`${idPrefix}-${valueName}`}>
        <Input
          id={`${idPrefix}-${valueName}`}
          name={valueName}
          inputMode="decimal"
          numeric
          required
          autoFocus={autoFocus}
          defaultValue={initial?.value ?? ""}
        />
      </Field>
      {children}
      <Field label={labels.note} htmlFor={`${idPrefix}-note`}>
        <Input id={`${idPrefix}-note`} name="note" maxLength={200} defaultValue={initial?.note ?? ""} />
      </Field>
    </>
  );
}
