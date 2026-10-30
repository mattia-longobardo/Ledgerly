import { describe, expect, it } from "vitest";
import {
  type AssetChoice,
  assetDialogDefaults,
  assetMatches,
  type LinkChoice,
  linkCandidates,
} from "./dialog-rules";

describe("assetDialogDefaults (D1, D2)", () => {
  it("starts Binance on crypto in EUR, with nothing chosen and the product empty", () => {
    expect(assetDialogDefaults({ category: "crypto", currency: "EUR", synced: true })).toEqual({
      classFilter: "crypto",
      currencyFilter: "EUR",
      draftClass: "crypto",
      product: "",
    });
  });

  it("starts a broker on every class, in its own currency", () => {
    expect(assetDialogDefaults({ category: "broker", currency: "USD", synced: true })).toEqual({
      classFilter: "",
      currencyFilter: "USD",
      draftClass: "etf",
      product: "",
    });
  });

  it("gives a manual service its one product, custody", () => {
    const defaults = assetDialogDefaults({ category: "broker", currency: "EUR", synced: false });
    expect(defaults.product).toBe("custody");
    expect(defaults.currencyFilter).toBe("EUR");
  });

  it("filters a crypto account on crypto even when it is a manual one", () => {
    expect(assetDialogDefaults({ category: "crypto", currency: "USD", synced: false })).toMatchObject({
      classFilter: "crypto",
      currencyFilter: "USD",
      product: "custody",
    });
  });
});

describe("assetMatches", () => {
  const atvi: AssetChoice = {
    id: "1",
    name: "Activision Blizzard, Inc.",
    class: "stock",
    symbol: "ATVI",
    isin: "US00507V1098",
    currency: "USD",
  };
  const btc: AssetChoice = {
    id: "2",
    name: "Bitcoin",
    class: "crypto",
    symbol: "BTC",
    isin: null,
    currency: "EUR",
  };

  it("leaves out what the audit found preselected on Binance (D1)", () => {
    const filter = { query: "", classFilter: "crypto", currencyFilter: "EUR" };
    expect(assetMatches(atvi, filter)).toBe(false);
    expect(assetMatches(btc, filter)).toBe(true);
  });

  it("searches name, symbol and ISIN, in any case", () => {
    const all = { classFilter: "", currencyFilter: "" };
    expect(assetMatches(atvi, { ...all, query: "atvi" })).toBe(true);
    expect(assetMatches(atvi, { ...all, query: "us00507" })).toBe(true);
    expect(assetMatches(atvi, { ...all, query: "blizzard" })).toBe(true);
    expect(assetMatches(btc, { ...all, query: "eth" })).toBe(false);
  });
});

describe("linkCandidates (D3)", () => {
  const choice = (id: string, on: string, cents: bigint, payee: string): LinkChoice => ({
    id,
    on,
    cents,
    payee,
    accountName: "ING Conto Arancio",
  });
  const choices = [
    choice("same", "2026-10-28", 200_000n, "Bonifico Directa"),
    choice("far", "2026-10-19", 200_000n, "Bonifico eToro"),
    choice("other", "2026-10-29", 450n, "Caffè"),
  ];

  it("offers only the same amount within three days", () => {
    expect(linkCandidates(choices, "2026-10-29", 200_000n, "", null).map((one) => one.id)).toEqual(["same"]);
  });

  it("offers nothing before the amount is typed", () => {
    expect(linkCandidates(choices, "2026-10-29", null, "", null)).toEqual([]);
  });

  it("finds any movement by payee or account with a search, the same amount first", () => {
    expect(linkCandidates(choices, "2026-10-29", 200_000n, "bonifico", null).map((one) => one.id)).toEqual([
      "same",
      "far",
    ]);
    expect(linkCandidates(choices, "2026-10-29", 200_000n, "arancio", null)).toHaveLength(3);
  });

  it("keeps the movement already linked", () => {
    expect(linkCandidates(choices, "2026-10-29", 200_000n, "", "far").map((one) => one.id)).toEqual([
      "far",
      "same",
    ]);
  });
});
