// The rules of a country as data (rewrite plan, 10-modularity.md §10.11, extension point E4). R0
// holds today's values as the data of Italy; the choice of the country at the first start (R5a) and
// the rest of the pack (payslip, absences, holidays: R5g) come later. A module takes its rule as a
// value: no country is written in its code.

/** The countries with a pack of rules. */
type Country = "IT";

interface CountryRules {
  /** The tax withheld on interest, in percent, that a new interest rule proposes. */
  interestTaxPercent: string;
}

const RULES: Record<Country, CountryRules> = {
  IT: { interestTaxPercent: "26" },
};

/** One rule of a country. */
export function countryRule<K extends keyof CountryRules>(country: Country, key: K): CountryRules[K] {
  return RULES[country][key];
}
