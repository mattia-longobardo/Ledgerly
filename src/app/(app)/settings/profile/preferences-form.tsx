"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState, useTransition } from "react";
import { savePreferencesAction } from "@/modules/users/actions";
import type { Preferences } from "@/modules/users/rules";
import { Button } from "@/ui/button";
import { Field } from "@/ui/field";
import { Checkbox, Input, Select } from "@/ui/input";
import { notify } from "@/ui/toast";

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

export function PreferencesForm({ initial, timeZones }: { initial: Preferences; timeZones: string[] }) {
  const t = useTranslations("settings.preferences");
  const common = useTranslations("common");
  const router = useRouter();
  const [prefs, setPrefs] = useState<Preferences>(initial);
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof Preferences>(key: K, value: Preferences[K]) =>
    setPrefs((p) => ({ ...p, [key]: value }));

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      await savePreferencesAction(prefs);
      notify(t("saved"));
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      <Field label={t("timeZone")} htmlFor="timeZone">
        <Select id="timeZone" value={prefs.timeZone} onChange={(e) => set("timeZone", e.target.value)}>
          {timeZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone}
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
            onChange={(e) =>
              set(
                "patronSaint",
                e.target.value ? { month: Number(e.target.value), day: prefs.patronSaint?.day ?? 1 } : null,
              )
            }
          >
            <option value="">{t("patronNone")}</option>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("patronSaint")}
            disabled={!prefs.patronSaint}
            value={prefs.patronSaint?.day ?? ""}
            onChange={(e) =>
              prefs.patronSaint &&
              set("patronSaint", { month: prefs.patronSaint.month, day: Number(e.target.value) })
            }
          >
            {DAYS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </div>
      </Field>
      <Checkbox
        className="sm:col-span-2"
        label={t("monthlySummary")}
        checked={prefs.monthlySummary}
        onChange={(e) => set("monthlySummary", e.target.checked)}
      />
      <div className="flex justify-end border-t border-border pt-3 sm:col-span-2">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {common("save")}
        </Button>
      </div>
    </form>
  );
}
