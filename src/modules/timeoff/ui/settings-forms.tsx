"use client";

import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useId, useState, useTransition } from "react";
import { saveTimeOffPreferencesAction } from "@/modules/users/actions";
import { Button } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Input, Select } from "@/ui/input";
import { notify } from "@/ui/toast";
import { saveAllowanceAction } from "../actions";
import type { AllowanceSummary } from "./leave-actions";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
// A non-leap-year probe (matches the server's own patron-saint validation): Feb has 28 days here.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(month: number | undefined): number {
  return month ? DAYS_IN_MONTH[month - 1] : 31;
}

/** The submit-and-say-so all three forms share. */
function useSave(success: string) {
  const t = useTranslations("timeoff");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const save = (work: () => Promise<{ ok: true } | { ok: false; error: string }>) =>
    start(async () => {
      try {
        const result = await work();
        if (!result.ok) {
          setError(t("errors.invalid"));
          return;
        }
        setError(null);
        notify(success);
        router.refresh();
      } catch {
        setError(t("errors.failed"));
      }
    });
  return { pending, error, save };
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
  const t = useTranslations("timeoff");
  const id = useId();
  const [vacationDays, setVacationDays] = useState(allowance.vacationDays);
  const [rolDays, setRolDays] = useState(allowance.rolDays);
  const [totalDays, setTotalDays] = useState(allowance.totalDays);
  const [note, setNote] = useState(allowance.note);
  const { pending, error, save } = useSave(t("toasts.allowanceSaved"));

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveAllowanceAction({ year: String(allowance.year), vacationDays, rolDays, totalDays, note }));
  }

  const number = (fieldId: string, value: string, onChange: (value: string) => void) => (
    <Input
      id={fieldId}
      type="number"
      min="0"
      max="400"
      step="0.5"
      className="tabular-nums"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("header.yearLabel")}</span>
        {stepper}
      </div>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 @lg:grid-cols-3">
        <Field label={t("allowance.vacationDays")} htmlFor={`${id}-vac`}>
          {number(`${id}-vac`, vacationDays, setVacationDays)}
        </Field>
        {/* Days, like vacation (N9): one unit on the whole screen, whatever the contract states. */}
        <Field label={t("allowance.rolDays")} htmlFor={`${id}-rol`}>
          {number(`${id}-rol`, rolDays, setRolDays)}
        </Field>
        <Field label={t("allowance.totalDays")} htmlFor={`${id}-total`}>
          {number(`${id}-total`, totalDays, setTotalDays)}
        </Field>
      </div>
      <Field label={t("dialog.note")} htmlFor={`${id}-note`}>
        <Input
          id={`${id}-note`}
          maxLength={200}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </Field>
      <ErrorLine error={error} />
      <CardFooter>
        {previous ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setVacationDays(previous.vacationDays);
              setRolDays(previous.rolDays);
              setTotalDays(previous.totalDays);
              setNote(previous.note);
            }}
          >
            {t("settings.copyFrom", { year: previous.year })}
          </Button>
        ) : (
          <span />
        )}
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("actions.save")}
        </Button>
      </CardFooter>
    </form>
  );
}

export function WorkingHoursForm({ minutesPerDay }: { minutesPerDay: number }) {
  const t = useTranslations("timeoff");
  const id = useId();
  const [minutes, setMinutes] = useState(minutesPerDay);
  const { pending, error, save } = useSave(t("settings.hours.saved"));

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveTimeOffPreferencesAction({ minutesPerDay: minutes }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div className="max-w-56">
        <Field label={t("settings.hours.label")} htmlFor={`${id}-hours`} hint={t("settings.hours.hint")}>
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
      </div>
      <ErrorLine error={error} />
      <CardFooter>
        <span />
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("actions.save")}
        </Button>
      </CardFooter>
    </form>
  );
}

export function PatronSaintForm({ patronSaint }: { patronSaint: { month: number; day: number } | null }) {
  const t = useTranslations("timeoff");
  const locale = useLocale();
  const id = useId();
  const [patron, setPatron] = useState(patronSaint);
  const { pending, error, save } = useSave(t("settings.patron.saved"));

  const monthFormatter = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const monthLabel = (month: number) => monthFormatter.format(new Date(Date.UTC(2023, month - 1, 1)));
  const days = Array.from({ length: daysInMonth(patron?.month) }, (_, i) => i + 1);

  function submit(event: FormEvent) {
    event.preventDefault();
    save(() => saveTimeOffPreferencesAction({ patronSaint: patron }));
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-3">
      <Field label={t("settings.patron.label")} htmlFor={`${id}-month`} hint={t("settings.patron.hint")}>
        <div className="flex gap-2">
          <Select
            id={`${id}-month`}
            value={patron?.month ?? ""}
            onChange={(event) => {
              const month = event.target.value ? Number(event.target.value) : null;
              setPatron(month ? { month, day: Math.min(patron?.day ?? 1, daysInMonth(month)) } : null);
            }}
          >
            <option value="">{t("settings.patron.none")}</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("settings.patron.day")}
            disabled={!patron}
            value={patron?.day ?? ""}
            onChange={(event) =>
              patron && setPatron({ month: patron.month, day: Number(event.target.value) })
            }
          >
            {days.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <ErrorLine error={error} />
      <CardFooter>
        <span />
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {t("actions.save")}
        </Button>
      </CardFooter>
    </form>
  );
}
