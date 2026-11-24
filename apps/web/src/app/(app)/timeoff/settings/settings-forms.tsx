"use client";

import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useId, useRef, useState, useTransition } from "react";
import { Field } from "@ledgerly/ui/field";
import { Input } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { useUnsavedForm } from "@ledgerly/ui/unsaved-changes";
import { saveTimeOffPreferencesAction, settingsChanged } from "./calls";

/**
 * The submit-and-say-so the forms of the page share. None has a Save button of its own: the banner of
 * the page submits the forms with a change (`useUnsavedForm`).
 */
export function useSave(success: string) {
  const text = useTranslations("timeoff");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const unsaved = useUnsavedForm(formRef, pending);
  const save = (work: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(text("errors.invalid"));
          return;
        }
        setError(null);
        unsaved.saved();
        notify(success);
        settingsChanged();
      } catch {
        setError(text("errors.failed"));
      }
    });
  return { pending, error, save, formRef };
}

export function ErrorLine({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  );
}

/** The year the form is about, and the stepper that changes it. */
export function YearRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

/** A number of days, in half days, as the allowance states it; a carry-over may be below zero. */
export function DaysInput({
  id,
  value,
  onChange,
  min = "0",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  min?: string;
}) {
  return (
    <Input
      id={id}
      type="number"
      min={min}
      max="400"
      step="0.5"
      className="tabular-nums"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export function WorkingHoursForm({ minutesPerDay }: { minutesPerDay: number }) {
  const text = useTranslations("timeoff");
  const id = useId();
  const [minutes, setMinutes] = useState(minutesPerDay);
  const { error, save, formRef } = useSave(text("settings.hours.saved"));

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveTimeOffPreferencesAction({ minutesPerDay: minutes }));
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
      <Field
        label={text("settings.hours.label")}
        htmlFor={`${id}-hours`}
        hint={text("settings.hours.hint")}
        hintBeside
      >
        <Input
          id={`${id}-hours`}
          // Left like the selects around it: `numeric` right-aligns, for amounts in a column.
          className="tabular-nums"
          type="number"
          min={1}
          max={12}
          step={0.25}
          value={minutes / 60}
          onChange={(event) => setMinutes(Math.round(Number(event.target.value) * 60))}
        />
      </Field>

      <ErrorLine error={error} />
    </form>
  );
}
