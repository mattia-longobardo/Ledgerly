import { describe, expect, it } from "vitest";
import {
  arrangeFees,
  assetsCost,
  contributionFee,
  type FeeLike,
  feeModes,
  feeValidOn,
  needsPeriod,
  periodFees,
  rateOf,
} from "./fees";

const fee = (overrides: Partial<FeeLike>): FeeLike => ({
  basis: "per_contribution",
  amountCents: null,
  rate: null,
  period: null,
  sourceId: null,
  component: null,
  validFrom: null,
  validTo: null,
  ...overrides,
});

describe("the shape of a fee", () => {
  it("asks a period only of a recurring fee and of a fee on the assets", () => {
    expect(needsPeriod("periodic")).toBe(true);
    expect(needsPeriod("on_assets")).toBe(true);
    expect(needsPeriod("one_off")).toBe(false);
    expect(needsPeriod("per_contribution")).toBe(false);
    expect(needsPeriod("per_request")).toBe(false);
  });

  it("takes a percentage on the assets, an amount on joining and on request, either elsewhere", () => {
    expect(feeModes("on_assets")).toEqual(["rate"]);
    expect(feeModes("one_off")).toEqual(["amount"]);
    expect(feeModes("per_request")).toEqual(["amount"]);
    expect(feeModes("per_contribution")).toEqual(["amount", "rate"]);
    expect(feeModes("periodic")).toEqual(["amount", "rate"]);
  });

  it("is in force between its two dates, both included, and always without them", () => {
    expect(feeValidOn({ validFrom: null, validTo: null }, "2026-05-01")).toBe(true);
    expect(feeValidOn({ validFrom: "2026-05-01", validTo: "2026-05-31" }, "2026-05-01")).toBe(true);
    expect(feeValidOn({ validFrom: "2026-05-01", validTo: "2026-05-31" }, "2026-06-01")).toBe(false);
    expect(feeValidOn({ validFrom: "2026-05-02", validTo: null }, "2026-05-01")).toBe(false);
  });

  it("takes a percentage of an amount, half up", () => {
    expect(rateOf(10_000n, "0.0125")).toBe(125n);
    expect(rateOf(333n, "0.005")).toBe(2n);
  });
});

describe("the fee proposed for a contribution", () => {
  const list = [
    fee({ amountCents: 100n, sourceId: "debit" }),
    fee({ rate: "0.01" }),
    fee({ basis: "periodic", amountCents: 300n, period: "quarter" }),
    fee({ amountCents: 50n, validTo: "2025-12-31" }),
  ];

  it("adds the fees on each contribution in force that day for that source", () => {
    expect(contributionFee(list, { on: "2026-03-05", chargedCents: 25_100n, sourceId: "debit" })).toBe(351n);
    // Another source does not pay the fee of the first.
    expect(contributionFee(list, { on: "2026-03-05", chargedCents: 25_100n, sourceId: null })).toBe(251n);
    expect(contributionFee(list, { on: "2025-06-05", chargedCents: 10_000n, sourceId: null })).toBe(150n);
  });

  it("is unknown, never zero, when the list has no such fee or the fees exceed the amount", () => {
    expect(contributionFee([], { on: "2026-03-05", chargedCents: 25_100n, sourceId: null })).toBeNull();
    expect(
      contributionFee([fee({ amountCents: 100n })], { on: "2026-03-05", chargedCents: 99n, sourceId: null }),
    ).toBeNull();
    expect(
      contributionFee([fee({ amountCents: 100n })], { on: "2026-03-05", chargedCents: 100n, sourceId: null }),
    ).toBe(100n);
  });
});

describe("the fees estimated for a payslip period", () => {
  const input = { sourceId: "payroll", period: "quarter" as const, on: "2026-05-01" };

  it("reads the joining fee and the recurring fee of the source's own period", () => {
    const list = [
      fee({ basis: "one_off", amountCents: 1_032n, sourceId: "payroll" }),
      fee({ basis: "periodic", amountCents: 300n, period: "quarter", sourceId: "payroll" }),
    ];
    expect(periodFees(list, input)).toEqual({ enrollmentCents: 1_032n, quarterCents: 300n });
  });

  it("brings a recurring fee stated for another span to the source's period", () => {
    const yearly = [fee({ basis: "periodic", amountCents: 1_200n, period: "year" })];
    expect(periodFees(yearly, input).quarterCents).toBe(300n);
    expect(periodFees(yearly, { ...input, period: "month" }).quarterCents).toBe(100n);
    const monthly = [fee({ basis: "periodic", amountCents: 100n, period: "month" })];
    expect(periodFees(monthly, input).quarterCents).toBe(300n);
  });

  it("leaves out a percentage, an expired fee, a fee of another source and the other bases", () => {
    const list = [
      fee({ basis: "periodic", rate: "0.01", period: "quarter" }),
      fee({ basis: "periodic", amountCents: 300n, period: "quarter", validTo: "2026-04-30" }),
      fee({ basis: "one_off", amountCents: 1_000n, sourceId: "another" }),
      fee({ basis: "per_request", amountCents: 1_000n }),
      fee({ basis: "per_contribution", amountCents: 100n }),
      fee({ basis: "on_assets", rate: "0.0008", period: "year" }),
    ];
    expect(periodFees(list, input)).toEqual({ enrollmentCents: 0n, quarterCents: 0n });
  });
});

describe("the yearly cost on the assets", () => {
  it("is the percentage of the value, brought to a year", () => {
    const yearly = [fee({ basis: "on_assets", rate: "0.0045", period: "year" })];
    expect(assetsCost(yearly, 900_000n, "2026-05-01")).toEqual({ cents: 4_050n, rate: 0.0045 });
    const quarterly = [fee({ basis: "on_assets", rate: "0.001", period: "quarter" })];
    expect(assetsCost(quarterly, 900_000n, "2026-05-01")).toEqual({ cents: 3_600n, rate: 0.004 });
  });

  it("adds every fee on the assets in force, and is absent with none", () => {
    const list = [
      fee({ basis: "on_assets", rate: "0.004", period: "year" }),
      fee({ basis: "on_assets", rate: "0.0005", period: "year" }),
      fee({ basis: "on_assets", rate: "0.5", period: "year", validTo: "2020-01-01" }),
    ];
    expect(assetsCost(list, 1_000_000n, "2026-05-01")).toEqual({ cents: 4_500n, rate: 0.0045 });
    expect(assetsCost([fee({ amountCents: 100n })], 1_000_000n, "2026-05-01")).toBeNull();
  });
});

describe("the order of the list", () => {
  it("puts the fees in force first, by basis and then by name, and the expired apart", () => {
    const list = [
      { ...fee({ basis: "on_assets" }), label: "Management" },
      { ...fee({ basis: "one_off" }), label: "Joining" },
      { ...fee({ basis: "periodic" }), label: "B" },
      { ...fee({ basis: "periodic" }), label: "A" },
      { ...fee({ basis: "per_contribution", validTo: "2026-01-31" }), label: "Old" },
    ];
    const { current, expired } = arrangeFees(list, "2026-05-01");
    expect(current.map((one) => one.label)).toEqual(["Joining", "A", "B", "Management"]);
    expect(expired.map((one) => one.label)).toEqual(["Old"]);
  });
});
