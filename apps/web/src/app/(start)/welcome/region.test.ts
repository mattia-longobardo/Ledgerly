import { describe, expect, it } from "vitest";
import { countryOptions } from "@/platform/country";
import { browserRegion, withCountry } from "./region";

const ITALY = {
  country: "IT",
  currency: "EUR",
  timeZone: "Europe/Rome",
  numberFormat: "it-IT" as const,
  locale: "it" as const,
  weekStart: 1 as const,
  interestTaxPercent: "26",
};

describe("browserRegion", () => {
  it("reads country, currency, format and language from the browser", () => {
    expect(browserRegion({ language: "en-US", timeZone: "America/New_York" })).toEqual({
      country: "US",
      displayCurrency: "USD",
      timeZone: "America/New_York",
      numberFormat: "en-US",
      locale: "en",
    });
    expect(browserRegion({ language: "en-GB", timeZone: "Europe/London" }).displayCurrency).toBe("GBP");
    expect(browserRegion({ language: "fr-FR", timeZone: "Europe/Paris" })).toMatchObject({
      country: "FR",
      displayCurrency: "EUR",
      numberFormat: "fr-FR",
      locale: "en",
    });
    expect(browserRegion({ language: "it-IT", timeZone: "Europe/Rome" })).toMatchObject({
      numberFormat: "it-IT",
      locale: "it",
    });
  });
});

describe("withCountry", () => {
  const browser = browserRegion({ language: "en-US", timeZone: "America/New_York" });

  it("takes the pack's values for a country with one", () => {
    expect(withCountry("IT", ITALY, browser)).toEqual({
      country: "IT",
      displayCurrency: "EUR",
      timeZone: "Europe/Rome",
      numberFormat: "it-IT",
      locale: "it",
    });
  });

  it("keeps the browser's values for a country without one: no Italian default (D3)", () => {
    expect(withCountry("DE", null, browser)).toEqual({ ...browser, country: "DE" });
  });
});

describe("countryOptions", () => {
  it("lists real countries only, by name", () => {
    const options = countryOptions("en");
    const codes = options.map((one) => one.code);
    expect(codes).toContain("IT");
    expect(codes).toContain("DE");
    expect(codes).not.toContain("EU");
    expect(codes).not.toContain("ZZ");
    expect(options.find((one) => one.code === "DE")?.name).toBe("Germany");
    const names = options.map((one) => one.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
  });
});
