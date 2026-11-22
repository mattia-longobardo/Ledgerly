import { describe, expect, it } from "vitest";
import {
  type GroupMeasure,
  groupTotals,
  type HeldAccount,
  portfolioRows,
  portfolioView,
  serviceKind,
} from "./rules";

const held = (accountId: string, displayCents: bigint | null, counted = true): HeldAccount => ({
  accountId,
  name: `Account ${accountId}`,
  currency: "EUR",
  type: accountId.startsWith("fund") ? "pension" : "investment",
  valueCents: displayCents,
  displayCents,
  counted,
});

const holders = {
  services: new Map([
    ["broker", { provider: "etoro", accountOrigin: "manual" }],
    ["manual", { provider: "manual", accountOrigin: "manual" }],
  ]),
  funds: new Map([["fund-account", { id: "fund", name: "Fondo" }]]),
};

const measure = (gainCents: bigint, rate: number | null, to: string): GroupMeasure => ({
  paidInCents: 100_00n,
  gainCents,
  rate,
  capital: rate === null ? null : Number(gainCents) / rate,
  to,
});

describe("the rows of the portfolio", () => {
  const accounts = [
    held("broker", 1000_00n),
    held("manual", 200_00n),
    held("value-only", 50_00n),
    held("fund-account", 300_00n),
    held("cash", 70_00n, false),
    held("off-total", 10_00n, false),
  ];
  const rows = portfolioRows(accounts, {
    ...holders,
    services: new Map([...holders.services, ["off-total", { provider: "manual", accountOrigin: "manual" }]]),
  });

  it("give each account its kind and its group, and leave out what is neither counted nor held", () => {
    expect(rows.map((row) => [row.accountId, row.kind, row.group])).toEqual([
      ["broker", "service", "stocks_crypto"],
      ["manual", "manual_portfolio", "stocks_crypto"],
      ["value-only", "manual_portfolio", "stocks_crypto"],
      ["fund-account", "pension_fund", "pension_funds"],
      ["off-total", "manual_portfolio", "stocks_crypto"],
    ]);
    expect(rows.find((row) => row.kind === "pension_fund")).toMatchObject({ name: "Fondo", fundId: "fund" });
  });

  it("add up only the counted rows, group by group, as Overview sums its bucket", () => {
    expect(groupTotals(rows)).toEqual([
      { group: "stocks_crypto", total: 1250_00n, partial: false, count: 3 },
      { group: "pension_funds", total: 300_00n, partial: false, count: 1 },
    ]);
  });

  it("make one total that is the sum of the two subtotals", () => {
    const view = portfolioView(rows, { stocks_crypto: null, pension_funds: null });
    expect(view.total.valueCents).toBe(1550_00n);
    expect(view.groups.map((group) => group.kpis.valueCents)).toEqual([1250_00n, 300_00n]);
  });

  it("group an account by its type, as Overview does, whatever holds it", () => {
    const rows = portfolioRows([{ ...held("kept", 20_00n), type: "pension" }], holders);
    expect(rows.map((row) => [row.kind, row.group])).toEqual([["manual_portfolio", "pension_funds"]]);
  });

  it("leave out a group with no row", () => {
    const view = portfolioView(portfolioRows([held("broker", 5_00n)], holders), {
      stocks_crypto: null,
      pension_funds: null,
    });
    expect(view.groups.map((group) => group.group)).toEqual(["stocks_crypto"]);
  });

  it("say the total is partial when a counted account has no value in the display currency", () => {
    const view = portfolioView(portfolioRows([held("broker", null), held("fund-account", 5_00n)], holders), {
      stocks_crypto: null,
      pension_funds: null,
    });
    expect(view.total).toMatchObject({ valueCents: 5_00n, valuePartial: true });
  });
});

describe("the kind of a service", () => {
  it("is `service` for a provider or an account a bank reads, `manual_portfolio` for a value by hand", () => {
    expect(serviceKind({ provider: "ccxt:binance", accountOrigin: "manual" })).toBe("service");
    expect(serviceKind({ provider: "manual", accountOrigin: "synced" })).toBe("service");
    expect(serviceKind({ provider: "manual", accountOrigin: "manual" })).toBe("manual_portfolio");
  });
});

describe("the KPIs of the period", () => {
  const rows = portfolioRows([held("broker", 1000_00n), held("fund-account", 300_00n)], holders);

  it("sum the money in and the gain, and divide the gains by the sum of the capitals", () => {
    const view = portfolioView(rows, {
      stocks_crypto: measure(50_00n, 0.05, "2026-11-22"),
      pension_funds: measure(10_00n, 0.02, "2026-11-18"),
    });
    expect(view.total).toMatchObject({ paidInCents: 200_00n, gainCents: 60_00n, rateReason: "ok" });
    // 6000 / (5000 / 0.05 + 1000 / 0.02) = 6000 / 150000.
    expect(view.total.rate).toBeCloseTo(0.04, 10);
    expect(view.groups.map((group) => group.kpis.rate)).toEqual([0.05, 0.02]);
  });

  it("give no rate for two groups whose last days are too far apart", () => {
    const view = portfolioView(rows, {
      stocks_crypto: measure(50_00n, 0.05, "2026-11-22"),
      pension_funds: measure(10_00n, 0.02, "2026-09-28"),
    });
    expect(view.total).toMatchObject({ gainCents: 60_00n, rate: null, rateReason: "mixed_ranges" });
  });

  it("give no rate when a group has none, but keep its gain", () => {
    const view = portfolioView(rows, {
      stocks_crypto: measure(50_00n, 0.05, "2026-11-22"),
      pension_funds: measure(10_00n, null, "2026-11-18"),
    });
    expect(view.total).toMatchObject({ gainCents: 60_00n, rate: null, rateReason: "not_computable" });
  });

  it("take the one group's rate when only one is measured", () => {
    const view = portfolioView(rows, {
      stocks_crypto: measure(50_00n, 0.05, "2026-11-22"),
      pension_funds: null,
    });
    expect(view.total).toMatchObject({ gainCents: 50_00n, rate: 0.05, rateReason: "ok" });
  });
});
