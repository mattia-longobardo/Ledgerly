"use client";

// How often something recurs (audit UI-INT-1, OP-6): one field for the cadences of the domain — an
// interest rule's payout, a subscription's billing — instead of a select written in each dialog.
import { Field } from "./field";
import { Select } from "./input";

export function RecurrenceField<T extends string>({
  id,
  name,
  label,
  hint,
  defaultValue,
  value,
  onChange,
  options,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  defaultValue?: T;
  /** With `onChange`, the form drives the value: a dialog that shows more fields for one cadence. */
  value?: T;
  onChange?: (value: T) => void;
  /** The cadences offered, in order, each with its label already translated. */
  options: readonly { value: T; label: string }[];
}) {
  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <Select
        id={id}
        name={name}
        defaultValue={defaultValue}
        value={value}
        onChange={
          onChange &&
          ((event) => {
            const picked = options.find((option) => option.value === event.target.value);
            if (picked) onChange(picked.value);
          })
        }
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
}
