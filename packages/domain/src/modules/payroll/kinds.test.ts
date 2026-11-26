// The kinds of a payslip, the employer's extra payments, the catalogue of fields and the payslip typed
// by hand (rewrite plan R5g, E4, E6, ST-21).
import { describe, expect, it } from "vitest";
import { MONEY_FIELDS } from "./fields";
import {
  BASE_FIELDS,
  COUNTRY_FIELDS,
  fieldCatalogue,
  kindOf,
  kindOfType,
  manualPayslipSchema,
  periodOfManual,
  REGISTER_FIELDS,
  SUMMED_FIELDS,
  theoreticalGross,
} from "./rules";

describe("the kind of a payslip", () => {
  it("turns the type a profile reads into a kind and an extra payment's number", () => {
    expect(kindOfType("thirteenth")).toEqual({ kind: "extra", extraNumber: 1 });
    expect(kindOfType("fourteenth")).toEqual({ kind: "extra", extraNumber: 2 });
    expect(kindOfType("bonus")).toEqual({ kind: "bonus", extraNumber: null });
  });

  it("is the stored kind and number", () => {
    expect(kindOf({ kind: "extra", extraNumber: 4 })).toEqual({ kind: "extra", extraNumber: 4 });
  });
});

describe("the catalogue of fields (E4)", () => {
  it("makes the register's columns: the base ones and the pack's summed ones", () => {
    expect(REGISTER_FIELDS.toSorted()).toEqual(SUMMED_FIELDS.toSorted());
  });

  it("has only amounts the payslip knows, none of them a base field", () => {
    const base = new Set<string>(BASE_FIELDS.map((field) => field.key));
    for (const field of COUNTRY_FIELDS) {
      expect(MONEY_FIELDS).toContain(field.key);
      expect(base.has(field.key)).toBe(false);
    }
  });

  it("offers the base fields only without a country's pack", () => {
    expect(fieldCatalogue(null).map((field) => field.key)).toEqual(["gross", "taxesTotal", "employeeSocial", "netPay"]);
    expect(fieldCatalogue("IT")).toHaveLength(BASE_FIELDS.length + COUNTRY_FIELDS.length);
  });
});

describe("theoreticalGross (owner's choice B, fallback C)", () => {
  const month = (period: string, gross: bigint | null, contractualGross: bigint | null) => ({
    kind: "ordinary" as const,
    extraNumber: null,
    year: Number(period.slice(0, 4)),
    period,
    gross,
    taxesTotal: null,
    netPay: null,
    contractualGross,
  });
  const extra = { ...month("2026-12-01", 999_999n, 999_999n), kind: "extra" as const, extraNumber: 1, period: null };
  const thirteen = { payFrequency: "monthly" as const, extraMonths: [12] };

  it("is the latest ordinary payslip's contractual pay × (12 + extra payments)", () => {
    const year = [month("2026-01-01", 210_000n, 200_000n), month("2026-10-01", 230_000n, 220_000n), extra];
    expect(theoreticalGross(year, thirteen)).toEqual({ cents: 220_000n * 13n, basis: "contractual", from: "2026-10-01", months: 13 });
    expect(theoreticalGross(year, { payFrequency: "monthly", extraMonths: [12, 6] })?.cents).toBe(220_000n * 14n);
    expect(theoreticalGross(year, { payFrequency: "monthly", extraMonths: [] })?.cents).toBe(220_000n * 12n);
  });

  it("falls back to the gross when the latest payslip has no contractual pay", () => {
    const year = [month("2026-01-01", 210_000n, 200_000n), month("2026-02-01", 205_000n, null)];
    expect(theoreticalGross(year, thirteen)).toEqual({ cents: 205_000n * 13n, basis: "gross", from: "2026-02-01", months: 13 });
  });

  it("reads a past year from its own latest month, never from its 13th", () => {
    const past = [month("2025-11-01", 190_000n, 180_000n), month("2025-12-01", 190_000n, 185_000n), { ...extra, year: 2025 }];
    expect(theoreticalGross(past, thirteen)).toMatchObject({ cents: 185_000n * 13n, from: "2025-12-01" });
  });

  it("is null without an ordinary payslip, or without any amount on it", () => {
    expect(theoreticalGross([extra], thirteen)).toBeNull();
    expect(theoreticalGross([], thirteen)).toBeNull();
    expect(theoreticalGross([month("2026-03-01", null, null)], thirteen)).toBeNull();
  });
});

describe("a payslip typed by hand (ST-21)", () => {
  const base = {
    kind: "ordinary",
    year: 2026,
    month: 3,
    extraNumber: null,
    paidOn: "2026-03-27",
    gross: 300_000n,
    taxes: 60_000n,
    contributions: 28_000n,
    net: 210_000n,
    fields: { irpefGross: 65_000n },
    documentId: null,
  };
  const valid = (input: object) => manualPayslipSchema.safeParse({ ...base, ...input }).success;

  it("takes a month's payslip and an extra payment by its number", () => {
    expect(valid({})).toBe(true);
    expect(valid({ kind: "extra", month: null, extraNumber: 1 })).toBe(true);
    expect(valid({ kind: "bonus", month: null })).toBe(true);
    expect(periodOfManual({ year: 2026, month: 3 })).toBe("2026-03-01");
  });

  it("refuses amounts that do not hold", () => {
    expect(valid({ net: 300_001n })).toBe(false);
    expect(valid({ gross: -1n })).toBe(false);
    expect(valid({ taxes: -1n })).toBe(false);
    expect(valid({ contributions: -1n })).toBe(false);
  });

  it("refuses a month or a number the kind does not take", () => {
    expect(valid({ month: null })).toBe(false);
    expect(valid({ extraNumber: 1 })).toBe(false);
    expect(valid({ kind: "extra", month: null, extraNumber: null })).toBe(false);
    expect(valid({ kind: "extra", month: 12, extraNumber: 1 })).toBe(false);
    expect(valid({ kind: "extra", month: null, extraNumber: 4 })).toBe(true);
    expect(valid({ kind: "extra", month: null, extraNumber: 13 })).toBe(false);
  });

  it("refuses a field outside the catalogue and a date that is not one", () => {
    expect(valid({ fields: { madeUp: 1n } })).toBe(false);
    expect(valid({ paidOn: "2026-02-30" })).toBe(false);
  });
});
