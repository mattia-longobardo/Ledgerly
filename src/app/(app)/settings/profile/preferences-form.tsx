"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { savePreferencesAction } from "@/modules/users/actions";
import type { Preferences } from "@/modules/users/rules";
import { DISPLAY_CURRENCIES } from "@/platform/fx/rules";
import { Button } from "@/ui/button";
import { CardFooter } from "@/ui/card";
import { Field } from "@/ui/field";
import { Checkbox, Select } from "@/ui/input";
import { useTheme } from "@/ui/theme-provider";
import { notify } from "@/ui/toast";

/**
 * Starts from the saved preferences; the page re-mounts it (keyed by them) whenever they change
 * elsewhere, e.g. the topbar theme toggle, so a save never writes an out-of-date value back.
 */
export function PreferencesForm({
  initial,
  timeZones,
  summaryBlocked = false,
}: {
  initial: Preferences;
  /** Every selectable IANA zone, labelled with its current UTC offset. */
  timeZones: { value: string; label: string }[];
  /** An admin turned this mail off for the whole instance: the box alone would promise too much. */
  summaryBlocked?: boolean;
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

  const currencyNames = new Intl.DisplayNames(locale === "it" ? "it-IT" : "en-US", { type: "currency" });

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
      <Field label={t("displayCurrency")} htmlFor="displayCurrency" hint={t("displayCurrencyHint")}>
        <Select
          id="displayCurrency"
          value={prefs.displayCurrency}
          onChange={(e) => set("displayCurrency", e.target.value as Preferences["displayCurrency"])}
        >
          {DISPLAY_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {`${code} · ${currencyNames.of(code) ?? code}`}
            </option>
          ))}
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
      {/* Only leave reads these, so they live with it (PERS-158); this says where they went. */}
      <p className="text-sm text-muted sm:col-span-2">
        {t.rich("timeOffMoved", {
          link: (chunks) => (
            <Link href="/timeoff/settings" className="focus-ring rounded-[4px] text-accent underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
      <CardFooter>
        <div className="flex flex-col gap-1">
          <Checkbox
            label={t("monthlySummary")}
            checked={prefs.monthlySummary}
            onChange={(e) => set("monthlySummary", e.target.checked)}
          />
          {summaryBlocked && <p className="text-sm text-warn">{t("monthlySummaryBlocked")}</p>}
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {common("save")}
        </Button>
      </CardFooter>
    </form>
  );
}
