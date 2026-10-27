import { describe, expect, it } from "vitest";
import {
  convertCents,
  ECB_FIRST_DAY,
  eurPerUnitOf,
  eurPerUnitOn,
  isDisplayCurrency,
  NO_RATES,
  rangesToFetch,
  rateTable,
  scaledOf,
} from "./rules";

describe("eurPerUnitOf", () => {
  it("turns 'units per euro' into 'euro per unit' at ten decimals", () => {
    expect(eurPerUnitOf(1.25)).toBe("0.8000000000");
    expect(eurPerUnitOf(0.83658)).toBe("1.1953429439");
    expect(eurPerUnitOf(1)).toBe("1.0000000000");
  });

  it("is null for a rate that cannot be one, or that rounds to zero", () => {
    expect(eurPerUnitOf(0)).toBeNull();
    expect(eurPerUnitOf(-1)).toBeNull();
    expect(eurPerUnitOf(Number.NaN)).toBeNull();
    expect(eurPerUnitOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(eurPerUnitOf(1e12)).toBeNull();
  });
});

describe("rangesToFetch", () => {
  const today = "2026-10-27";

  it("asks for nothing while there is no balance to convert", () => {
    expect(rangesToFetch({ firstBalanceOn: null, earliest: null, latest: null, today })).toEqual([]);
    expect(
      rangesToFetch({ firstBalanceOn: null, earliest: "2026-10-01", latest: "2026-10-20", today }),
    ).toEqual([]);
  });

  it("backfills an empty table from the first balance to today", () => {
    expect(rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: null, latest: null, today })).toEqual([
      { from: "2024-03-10", to: today },
    ]);
  });

  it("never asks for days before the first ECB rate, nor after today", () => {
    expect(rangesToFetch({ firstBalanceOn: "1990-01-01", earliest: null, latest: null, today })).toEqual([
      { from: ECB_FIRST_DAY, to: today },
    ]);
    expect(rangesToFetch({ firstBalanceOn: "2027-01-01", earliest: null, latest: null, today })).toEqual([
      { from: today, to: today },
    ]);
  });

  it("asks only for the days after the last stored one", () => {
    expect(
      rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: "2024-03-08", latest: "2026-10-23", today }),
    ).toEqual([{ from: "2026-10-24", to: today }]);
    expect(
      rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: "2024-03-08", latest: today, today }),
    ).toEqual([]);
  });

  it("fills in the past when a balance older than the table appears", () => {
    expect(
      rangesToFetch({ firstBalanceOn: "2020-01-01", earliest: "2024-03-08", latest: today, today }),
    ).toEqual([{ from: "2020-01-01", to: "2024-03-07" }]);
  });
});

describe("convertCents", () => {
  // Friday 27/03 and Tuesday 31/03: the weekend in between has no fixing.
  const rates = rateTable([
    { on: "2026-03-31", currency: "USD", eurPerUnit: "0.9000000000" },
    { on: "2026-03-27", currency: "USD", eurPerUnit: "0.8000000000" },
    { on: "2026-03-27", currency: "GBP", eurPerUnit: "1.2000000000" },
  ]);

  it("returns the same cents when the currencies match, with no rate at all", () => {
    expect(convertCents(123_456n, "EUR", "EUR", "2026-03-28", NO_RATES)).toBe(123_456n);
    expect(convertCents(-5n, "XYZ", "XYZ", "2026-03-28", NO_RATES)).toBe(-5n);
  });

  it("converts to and from EUR with the day's rate", () => {
    expect(convertCents(10_000n, "USD", "EUR", "2026-03-27", rates)).toBe(8_000n);
    expect(convertCents(8_000n, "EUR", "USD", "2026-03-27", rates)).toBe(10_000n);
    expect(convertCents(10_000n, "USD", "EUR", "2026-03-31", rates)).toBe(9_000n);
  });

  it("takes the last fixing on or before the day over a weekend", () => {
    expect(convertCents(10_000n, "USD", "EUR", "2026-03-29", rates)).toBe(8_000n);
    expect(eurPerUnitOn(rates, "USD", "2026-04-15")).toBe(scaledOf("0.9"));
  });

  it("crosses two non-EUR currencies through EUR", () => {
    // 100 GBP = 120 EUR = 150 USD at 0.80 EUR per USD.
    expect(convertCents(10_000n, "GBP", "USD", "2026-03-27", rates)).toBe(15_000n);
  });

  it("is null when either side has no rate: never 1:1", () => {
    expect(convertCents(10_000n, "USD", "EUR", "2026-03-26", rates)).toBeNull();
    expect(convertCents(10_000n, "XYZ", "EUR", "2026-03-27", rates)).toBeNull();
    expect(convertCents(10_000n, "EUR", "CHF", "2026-03-27", rates)).toBeNull();
  });

  it("rounds to the cent half away from zero", () => {
    const third = rateTable([{ on: "2026-01-02", currency: "USD", eurPerUnit: "0.3333333333" }]);
    expect(convertCents(1n, "USD", "EUR", "2026-01-02", third)).toBe(0n);
    const half = rateTable([{ on: "2026-01-02", currency: "USD", eurPerUnit: "0.5000000000" }]);
    expect(convertCents(1n, "USD", "EUR", "2026-01-02", half)).toBe(1n);
    expect(convertCents(-1n, "USD", "EUR", "2026-01-02", half)).toBe(-1n);
    expect(convertCents(3n, "USD", "EUR", "2026-01-02", half)).toBe(2n);
    expect(convertCents(-3n, "USD", "EUR", "2026-01-02", half)).toBe(-2n);
  });
});

describe("isDisplayCurrency", () => {
  it("accepts EUR and the ECB currencies only", () => {
    expect(isDisplayCurrency("EUR")).toBe(true);
    expect(isDisplayCurrency("USD")).toBe(true);
    expect(isDisplayCurrency("BGN")).toBe(false);
    expect(isDisplayCurrency("usd")).toBe(false);
  });
});
