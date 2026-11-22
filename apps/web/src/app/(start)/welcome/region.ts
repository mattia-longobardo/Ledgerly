// What the first start proposes for «Country and format» (rewrite plan R5a, E4, D3): the instance's
// defaults when an admin chose them, otherwise the browser; a country with a pack then proposes its
// own values, and one without a pack keeps the browser's. Never a fixed country's values.
import { DISPLAY_CURRENCIES } from "@ledgerly/domain/platform/fx/client";
import type { CountryPack } from "@/platform/country";

export interface Region {
  country: string | null;
  displayCurrency: string;
  timeZone: string;
  numberFormat: "it-IT" | "en-US" | "fr-FR";
  locale: "en" | "it";
}

/** What a browser says about itself: its language tag and its time zone. */
interface BrowserFacts {
  language: string;
  timeZone: string;
}

export function browserFacts(): BrowserFacts {
  return { language: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

/** The number format whose separators the browser's language writes. */
function numberFormatOf(language: string): Region["numberFormat"] {
  const parts = new Intl.NumberFormat(language).formatToParts(1234567.5);
  const decimal = parts.find((part) => part.type === "decimal")?.value;
  const group = parts.find((part) => part.type === "group")?.value ?? "";
  if (decimal === ",") return group === "." ? "it-IT" : "fr-FR";
  return "en-US";
}

function regionOf(language: string): string | null {
  try {
    return new Intl.Locale(language).maximize().region ?? null;
  } catch {
    return null;
  }
}

/**
 * The currency of a region: a national ISO 4217 code starts with the ISO 3166 code of its country
 * (USD, GBP, CHF…). A region with none of the display currencies, the euro area included, gets the
 * application's own currency (the first of the list, EUR).
 */
function currencyOf(region: string | null): string {
  return (region && DISPLAY_CURRENCIES.find((code) => code.startsWith(region))) || DISPLAY_CURRENCIES[0];
}

/** The browser's own proposal: its country, currency, zone, number format and language. */
export function browserRegion({ language, timeZone }: BrowserFacts): Region {
  const country = regionOf(language);
  return {
    country,
    displayCurrency: currencyOf(country),
    timeZone,
    numberFormat: numberFormatOf(language),
    locale: language.toLowerCase().startsWith("it") ? "it" : "en",
  };
}

/** What `country` proposes: its pack's values when it has one, the browser's when it has not (D3). */
export function withCountry(country: string | null, pack: CountryPack | null, browser: Region): Region {
  if (!pack) return { ...browser, country };
  return {
    country,
    displayCurrency: pack.currency,
    timeZone: pack.timeZone,
    numberFormat: pack.numberFormat,
    locale: pack.locale,
  };
}
