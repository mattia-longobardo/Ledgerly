"use client";

import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { savePreferencesAction } from "@/modules/users/actions";
import type { Preferences } from "@/modules/users/rules";
import { Button } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { useTheme } from "@/ui/theme-provider";
import { notify } from "@/ui/toast";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
// A non-leap-year probe (matches the server's own patron-saint validation): Feb has 28 days here.
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function daysInMonth(month: number | undefined): number {
  return month ? DAYS_IN_MONTH[month - 1] : 31;
}

/**
 * Starts from the saved preferences; the page re-mounts it (keyed by them) whenever they change
 * elsewhere, e.g. the topbar theme toggle, so a save never writes an out-of-date value back.
 */
export function PreferencesForm({
  initial,
  timeZones,
}: {
  initial: Preferences;
  /** Every selectable IANA zone, labelled with its current UTC offset. */
  timeZones: { value: string; label: string }[];
}) {
  const t = useTranslations("settings.preferences");
  const common = useTranslations("common");
  const locale = useLocale();
  const { setPreference: setTheme } = useTheme();
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  const monthFormatter = new Intl.DateTimeFormat(locale === "it" ? "it-IT" : "en-US", {
    month: "long",
    timeZone: "UTC",
  });
  const monthLabel = (month: number) => monthFormatter.format(new Date(Date.UTC(2023, month - 1, 1)));
  const days = Array.from({ length: daysInMonth(prefs.patronSaint?.month) }, (_, i) => i + 1);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        const result = await savePreferencesAction(prefs);
        if (!result.ok) {
          setError(result.error === "invalid" ? t("errors.invalid") : t("errors.failed"));
          return;
        }
        setError(null);
        setTheme(prefs.theme);
        notify(t("saved"));
      } catch {
        setError(t("errors.failed"));
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {error && (
        <p role="alert" className="text-sm text-neg sm:col-span-2">
          {error}
        </p>
      )}
      <Field label={t("timeZone")} htmlFor="timeZone">
        <Select id="timeZone" value={prefs.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
          {timeZones.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("language")} htmlFor="language">
        <Select
          id="language"
          value={prefs.locale}
          onChange={(e) => set("locale", e.target.value as Preferences["locale"])}
        >
          <option value="en">{t("languages.en")}</option>
          <option value="it">{t("languages.it")}</option>
        </Select>
      </Field>
      <Field label={t("numberFormat")} htmlFor="numberFormat">
        <Select
          id="numberFormat"
          value={prefs.numberFormat}
          onChange={(e) => set("numberFormat", e.target.value as Preferences["numberFormat"])}
        >
          <option value="it-IT">{t("numberFormats.it-IT")}</option>
          <option value="en-US">{t("numberFormats.en-US")}</option>
          <option value="fr-FR">{t("numberFormats.fr-FR")}</option>
        </Select>
      </Field>
      <Field label={t("decimalSeparator")} htmlFor="decimalSeparator">
        <Select
          id="decimalSeparator"
          value={prefs.decimalSeparator ?? ""}
          onChange={(e) =>
            set("decimalSeparator", (e.target.value || null) as Preferences["decimalSeparator"])
          }
        >
          <option value="">{t("decimalSeparators.auto")}</option>
          <option value=".">{t("decimalSeparators.dot")}</option>
          <option value=",">{t("decimalSeparators.comma")}</option>
        </Select>
      </Field>
      <Field label={t("currencyPosition")} htmlFor="currencyPosition">
        <Select
          id="currencyPosition"
          value={prefs.currencyPosition ?? ""}
          onChange={(e) =>
            set("currencyPosition", (e.target.value || null) as Preferences["currencyPosition"])
          }
        >
          <option value="">{t("currencyPositions.auto")}</option>
          <option value="before">{t("currencyPositions.before")}</option>
          <option value="after">{t("currencyPositions.after")}</option>
        </Select>
      </Field>
      <Field label={t("weekStart")} htmlFor="weekStart">
        <Select
          id="weekStart"
          value={prefs.weekStart}
          onChange={(e) => set("weekStart", e.target.value === "0" ? 0 : 1)}
        >
          <option value={1}>{t("weekStarts.monday")}</option>
          <option value={0}>{t("weekStarts.sunday")}</option>
        </Select>
      </Field>
      <Field label={t("theme")} htmlFor="theme">
        <Select
          id="theme"
          value={prefs.theme}
          onChange={(e) => set("theme", e.target.value as Preferences["theme"])}
        >
          <option value="system">{t("themes.system")}</option>
          <option value="light">{t("themes.light")}</option>
          <option value="dark">{t("themes.dark")}</option>
        </Select>
      </Field>
      <Field label={t("defaultRange")} htmlFor="defaultRange">
        <Select
          id="defaultRange"
          value={prefs.defaultRange}
          onChange={(e) => set("defaultRange", e.target.value as Preferences["defaultRange"])}
        >
          <option value="this_month">{t("ranges.this_month")}</option>
          <option value="last_30_days">{t("ranges.last_30_days")}</option>
          <option value="year_to_date">{t("ranges.year_to_date")}</option>
        </Select>
      </Field>
      <Field label={t("hoursPerDay")} htmlFor="hoursPerDay">
        <Input
          id="hoursPerDay"
          numeric
          type="number"
          min={1}
          max={12}
          step={0.25}
          value={prefs.minutesPerDay / 60}
          onChange={(e) => set("minutesPerDay", Math.round(Number(e.target.value) * 60))}
        />
      </Field>
      <Field label={t("patronSaint")} htmlFor="patronMonth">
        <div className="flex gap-2">
          <Select
            id="patronMonth"
            value={prefs.patronSaint?.month ?? ""}
            onChange={(e) => {
              const month = e.target.value ? Number(e.target.value) : null;
              set(
                "patronSaint",
                month ? { month, day: Math.min(prefs.patronSaint?.day ?? 1, daysInMonth(month)) } : null,
              );
            }}
          >
            <option value="">{t("patronNone")}</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("patronDay")}
            disabled={!prefs.patronSaint}
            value={prefs.patronSaint?.day ?? ""}
            onChange={(e) =>
              prefs.patronSaint &&
              set("patronSaint", { month: prefs.patronSaint.month, day: Number(e.target.value) })
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
      <CardFooter>
        <Checkbox
          label={t("monthlySummary")}
          checked={prefs.monthlySummary}
          onChange={(e) => set("monthlySummary", e.target.checked)}
        />
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {common("save")}
        </Button>
      </CardFooter>
    </form>
  );
}
