"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useId, useRef, useState, useTransition } from "react";
import { Button } from "@ledgerly/ui/button";
import { CardFooter } from "@ledgerly/ui/card";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";
import { notify } from "@ledgerly/ui/toast";
import { useUnsavedForm } from "@ledgerly/ui/unsaved-changes";
import { saveAllowanceAction, saveTimeOffPreferencesAction, settingsChanged } from "./calls";

import { FIELD_GRID } from "@ledgerly/ui/section";
import { intlLocale } from "@ledgerly/format/format";

/** The year's allowance as the dialog shows it, in the units a contract states. */
export interface AllowanceSummary {
  year: number;
  vacationDays: string;
  rolDays: string;
  /** Vacation and ROL together, in days, as the contract states it (N7). */
  totalDays: string;
  note: string;
}

const MONTHS = Array.from({ length: 12 }, (_unused, index) => index + 1);
// A non-leap-year probe (matches the server's own patron-saint validation): Feb has 28 days here.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(month: number | undefined): number {
  return month ? DAYS_IN_MONTH[month - 1] : 31;
}

/**
 * The submit-and-say-so all three forms share. None has a Save button of its own: the banner of
 * the page submits the forms with a change (`useUnsavedForm`).
 */
function useSave(success: string) {
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

function ErrorLine({ error }: { error: string | null }) {
  if (error === null) return null;
  return (
    <p role="alert" className="text-sm text-neg">
      {error}
    </p>
  );
}

/**
 * The year's allowance. The stepper above it changes the year through the URL; the page re-mounts
 * this form (keyed by the year), so a value typed for one year is never saved under another.
 */
export function AllowanceForm({
  allowance,
  previous,
  stepper,
}: {
  allowance: AllowanceSummary;
  /** Last year's, to start from; null when there is none. */
  previous: AllowanceSummary | null;
  stepper: ReactNode;
}) {
  const text = useTranslations("timeoff");
  const id = useId();
  // The year stays the form's own: «Copy from» brings last year's figures, never its year.
  const [fields, setFields] = useState(allowance);
  const set = (key: "vacationDays" | "rolDays" | "totalDays" | "note") => (value: string) =>
    setFields((was) => ({ ...was, [key]: value }));
  const { pending, error, save, formRef } = useSave(text("toasts.allowanceSaved"));

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveAllowanceAction({ ...fields, year: String(allowance.year) }));
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3">
      <YearRow label={text("header.yearLabel")}>{stepper}</YearRow>
      <div className={FIELD_GRID}>
        <Field label={text("allowance.vacationDays")} htmlFor={`${id}-vac`}>
          <DaysInput id={`${id}-vac`} value={fields.vacationDays} onChange={set("vacationDays")} />
        </Field>
        {/* Days, like vacation (N9): one unit on the whole screen, whatever the contract states. */}
        <Field label={text("allowance.rolDays")} htmlFor={`${id}-rol`}>
          <DaysInput id={`${id}-rol`} value={fields.rolDays} onChange={set("rolDays")} />
        </Field>
        <Field label={text("allowance.totalDays")} htmlFor={`${id}-total`}>
          <DaysInput id={`${id}-total`} value={fields.totalDays} onChange={set("totalDays")} />
        </Field>
        <Field label={text("dialog.note")} htmlFor={`${id}-note`}>
          <Input
            id={`${id}-note`}
            maxLength={200}
            value={fields.note}
            onChange={(event) => set("note")(event.target.value)}
          />
        </Field>
      </div>
      <ErrorLine error={error} />
      {previous && (
        <CardFooter>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => setFields({ ...previous, year: allowance.year })}
          >
            {text("settings.copyFrom", { year: previous.year })}
          </Button>
        </CardFooter>
      )}
    </form>
  );
}

/** The year the form is about, and the stepper that changes it. */
function YearRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

/** A number of days, in half days, as the allowance states it. */
function DaysInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      min="0"
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

export function PatronSaintForm({ patronSaint }: { patronSaint: { month: number; day: number } | null }) {
  const text = useTranslations("timeoff");
  const locale = useLocale();
  const id = useId();
  const [patron, setPatron] = useState(patronSaint);
  const { error, save, formRef } = useSave(text("settings.patron.saved"));

  const monthFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    month: "long",
    timeZone: "UTC",
  });
  const monthLabel = (month: number) => monthFormatter.format(new Date(Date.UTC(2023, month - 1, 1)));
  const days = Array.from({ length: daysInMonth(patron?.month) }, (_unused, index) => index + 1);

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveTimeOffPreferencesAction({ patronSaint: patron }));
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-3">
      <Field
        label={text("settings.patron.label")}
        htmlFor={`${id}-month`}
        hint={text("settings.patron.hint")}
        hintBeside
      >
        <div className="flex gap-2">
          <Select
            id={`${id}-month`}
            value={patron?.month ?? ""}
            onChange={(event) => {
              const month = event.target.value ? Number(event.target.value) : null;
              setPatron(month ? { month, day: Math.min(patron?.day ?? 1, daysInMonth(month)) } : null);
            }}
          >
            <option value="">{text("settings.patron.none")}</option>
            {MONTHS.map((month) => (
              <option key={month} value={month}>
                {monthLabel(month)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={text("settings.patron.day")}
            disabled={!patron}
            value={patron?.day ?? ""}
            onChange={(event) =>
              patron && setPatron({ month: patron.month, day: Number(event.target.value) })
            }
          >
            {days.map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </Select>
        </div>
      </Field>

      <ErrorLine error={error} />
    </form>
  );
}
