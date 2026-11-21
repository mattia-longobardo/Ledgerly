"use client";

// The fields a form dialog is made of (audit UI-DS-11): a day, an amount in a currency, a plain
// number. Each is a labelled `Field`; the value is the text as typed, read by the caller's `calls.ts`.
import { Field } from "./field";
import { Input, InputGroup } from "./input";

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}

/** A day, never past `max` (today, for what already happened). */
export function DateField({ id, label, value, onChange, max }: TextFieldProps & { max: string }) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        type="date"
        required
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** An amount, with its currency beside it. */
export function MoneyField({
  id,
  label,
  value,
  onChange,
  currency,
  hint,
  autoFocus,
}: TextFieldProps & { currency: string; hint?: string; autoFocus?: boolean }) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <InputGroup suffix={currency}>
        <Input
          id={id}
          inputMode="decimal"
          numeric
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </InputGroup>
    </Field>
  );
}

/** A quantity: a number with no currency. */
export function NumberField({ id, label, value, onChange }: TextFieldProps) {
  return (
    <Field label={label} htmlFor={id}>
      <Input
        id={id}
        inputMode="decimal"
        numeric
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}
