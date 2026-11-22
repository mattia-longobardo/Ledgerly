// The rules of a country as data (rewrite plan, 10-modularity.md §10.11, extension point E4). Italy
// is the one pack today; R5a proposes a pack's defaults at the first start, and R5g adds the rest
// (payslip, absences, holidays). A module takes its rule as a value: no country is written in its
// code. A country without a pack has no rules: its fields stay empty (D3).

/** The countries with a pack of rules. */
export const COUNTRIES = ["IT"] as const;
type Country = (typeof COUNTRIES)[number];

interface CountryRules {
  /** The tax withheld on interest, in percent, that a new interest rule proposes. */
  interestTaxPercent: string;
  /** What the first start proposes for a person of the country. */
  currency: string;
  timeZone: string;
  numberFormat: "it-IT" | "en-US" | "fr-FR";
  locale: "en" | "it";
  weekStart: 0 | 1;
}

const RULES: Record<Country, CountryRules> = {
  IT: {
    interestTaxPercent: "26",
    currency: "EUR",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    locale: "it",
    weekStart: 1,
  },
};

/** Whether `country` has a pack of rules. */
export function hasPack(country: string | null): country is Country {
  return COUNTRIES.some((one) => one === country);
}

/** One rule of a country. */
export function countryRule<K extends keyof CountryRules>(country: Country, key: K): CountryRules[K] {
  return RULES[country][key];
}

/** Every rule of a country with a pack. */
export function countryRules(country: Country): Readonly<CountryRules> {
  return RULES[country];
}
