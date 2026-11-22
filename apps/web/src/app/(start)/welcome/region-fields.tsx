"use client";

// «Country and format» of the first start: the country, which proposes the rest through its pack,
// and the four fields it proposes, each one the person's to change.
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { DISPLAY_CURRENCIES } from "@ledgerly/domain/platform/fx/client";
import { intlLocale } from "@ledgerly/format/format";
import { Field } from "@ledgerly/ui/field";
import { Select } from "@ledgerly/ui/input";
import { FIELD_GRID } from "@ledgerly/ui/section";
import { countryOptions } from "@/platform/country";
import type { Region } from "./region";

const NUMBER_FORMATS = ["it-IT", "en-US", "fr-FR"] as const;
const LANGUAGES = ["en", "it"] as const;

/** The option of `options` a select answered; a select offers nothing else. */
function chosen<T extends string>(options: readonly T[], value: string): T {
  return options.find((one) => one === value) ?? options[0];
}

interface Props {
  region: Region;
  timeZones: { value: string; label: string }[];
  onChange: (region: Region) => void;
  onCountry: (country: string | null) => void;
}

export function RegionFields({ region, timeZones, onChange, onCountry }: Props) {
  const text = useTranslations("welcome");
  const locale = useLocale();
  const [countries] = useState(() => countryOptions(intlLocale(locale)));
  return (
    <div className={FIELD_GRID}>
      <Field label={text("country")} htmlFor="country" hint={text("countryHint")}>
        <Select
          id="country"
          value={region.country ?? ""}
          onChange={(event) => onCountry(event.target.value || null)}
        >
          <option value="">{text("noCountry")}</option>
          {countries.map(({ code, name }) => (
            <option key={code} value={code}>
              {name}
            </option>
          ))}
        </Select>
      </Field>
      <FormatFields region={region} timeZones={timeZones} onChange={onChange} />
    </div>
  );
}

function FormatFields({ region, timeZones, onChange }: Omit<Props, "onCountry">) {
  const prefs = useTranslations("settings.preferences");
  const currencyNames = new Intl.DisplayNames(intlLocale(useLocale()), { type: "currency" });
  const set = <K extends keyof Region>(key: K, value: Region[K]) => onChange({ ...region, [key]: value });
  // The browser's zone may be one the server's list does not name: it is offered all the same.
  const zones = timeZones.some((zone) => zone.value === region.timeZone)
    ? timeZones
    : [{ value: region.timeZone, label: region.timeZone }, ...timeZones];
  return (
    <>
      <Field label={prefs("displayCurrency")} htmlFor="displayCurrency">
        <Select
          id="displayCurrency"
          value={region.displayCurrency}
          onChange={(event) => set("displayCurrency", event.target.value)}
        >
          {DISPLAY_CURRENCIES.map((code) => (
            <option key={code} value={code}>
              {`${code} · ${currencyNames.of(code) ?? code}`}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={prefs("timeZone")} htmlFor="timeZone">
        <Select
          id="timeZone"
          value={region.timeZone}
          onChange={(event) => set("timeZone", event.target.value)}
        >
          {zones.map((zone) => (
            <option key={zone.value} value={zone.value}>
              {zone.label}
            </option>
          ))}
        </Select>
      </Field>
      <ChoiceField
        id="numberFormat"
        label={prefs("numberFormat")}
        value={region.numberFormat}
        options={NUMBER_FORMATS}
        labelOf={(format) => prefs(`numberFormats.${format}`)}
        onChange={(format) => set("numberFormat", format)}
      />
      <ChoiceField
        id="language"
        label={prefs("language")}
        value={region.locale}
        options={LANGUAGES}
        labelOf={(language) => prefs(`languages.${language}`)}
        onChange={(language) => set("locale", language)}
      />
    </>
  );
}

/** A select of a fixed list of values. */
function ChoiceField<T extends string>({
  id,
  label,
  value,
  options,
  labelOf,
  onChange,
}: {
  id: string;
  label: string;
  value: T;
  options: readonly T[];
  labelOf: (option: T) => string;
  onChange: (option: T) => void;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <Select id={id} value={value} onChange={(event) => onChange(chosen(options, event.target.value))}>
        {options.map((option) => (
          <option key={option} value={option}>
            {labelOf(option)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
