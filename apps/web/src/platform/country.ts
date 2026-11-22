"use client";

// The pack of the person's country (rewrite plan R5a, E4): what a screen proposes comes from
// `GET /countries` for the country of `GET /onboarding`. A country without a pack proposes nothing (D3).
import { ONBOARDING } from "@ledgerly/api-contract";
import type { RouteOutput } from "@ledgerly/api-client";
import { useApi } from "@ledgerly/ui/data";

export type CountryPack = RouteOutput<typeof ONBOARDING.listCountries>["countries"][number];

/** The pack of `country`, or null when it has none. */
export function packOf(packs: readonly CountryPack[], country: string | null): CountryPack | null {
  return packs.find((pack) => pack.country === country) ?? null;
}

/** The pack of the person's country: null without one or when it cannot be read, `undefined` while it loads. */
export function useCountryPack(): CountryPack | null | undefined {
  const packs = useApi(ONBOARDING.listCountries, {});
  const person = useApi(ONBOARDING.getOnboarding, {});
  if (packs.error || person.error) return null;
  if (!packs.data || !person.data) return undefined;
  return packOf(packs.data.countries, person.data.country);
}

/** Codes that name no country: the EU, the euro area, the UN and the private-use ones. */
const NOT_COUNTRIES = new Set(["EU", "EZ", "UN", "QO", "XA", "XB", "ZZ"]);

/**
 * Every country the browser has a name for, sorted by that name. Generated from the two-letter
 * codes, so no list is kept by hand.
 */
export function countryOptions(locale: string): { code: string; name: string }[] {
  const names = new Intl.DisplayNames([locale], { type: "region", fallback: "none" });
  const letters = Array.from({ length: 26 }, (_unused, index) => String.fromCharCode(65 + index));
  return letters
    .flatMap((first) => letters.map((second) => first + second))
    .filter((code) => !NOT_COUNTRIES.has(code))
    .flatMap((code) => {
      const name = names.of(code);
      return name && name !== code ? [{ code, name }] : [];
    })
    .sort((one, other) => one.name.localeCompare(other.name, locale));
}
