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
  PAYSLIP_TYPES,
  periodOfManual,
  ralEstimate,
  REGISTER_FIELDS,
  type RegisterPayslip,
  SUMMED_FIELDS,
  typeOfKind,
} from "./rules";

describe("the kind of a payslip and its old type", () => {
  it("maps every old type to a kind and back", () => {
    for (const type of PAYSLIP_TYPES) {
      const { kind, extraNumber } = kindOfType(type);
      expect(typeOfKind(kind, extraNumber)).toBe(type);
    }
    expect(kindOfType("fourteenth")).toEqual({ kind: "extra", extraNumber: 2 });
  });

  it("has no old type for a fourth extra payment", () => {
    expect(() => typeOfKind("extra", 4)).toThrow(RangeError);
  });

  it("reads the stored kind first, the old type on a row without one", () => {
    expect(kindOf({ type: "thirteenth", kind: null })).toEqual({ kind: "extra", extraNumber: 1 });
    expect(kindOf({ type: "bonus", kind: "bonus", extraNumber: null })).toEqual({ kind: "bonus", extraNumber: null });
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

describe("ralEstimate with the employer's extra payments (E6)", () => {
  const month = (period: string, gross: bigint): RegisterPayslip => ({
    type: "ordinary",
    year: 2026,
    period,
    gross,
    taxesTotal: null,
    netPay: null,
  });
  const months = (count: number) =>
    Array.from({ length: count }, (_, index) => month(`2026-${String(index + 1).padStart(2, "0")}-01`, 100_000n));
  const extra = (number: number, gross: bigint): RegisterPayslip => ({
    type: typeOfKind("extra", number),
    kind: "extra",
    extraNumber: number,
    year: 2026,
    period: null,
    gross,
    taxesTotal: null,
    netPay: null,
  });

  it("puts a mean month for every extra payment the employer makes and the year lacks", () => {
    const employer = { payFrequency: "monthly" as const, extraMonths: [12, 6] };
    expect(ralEstimate(months(3), employer)).toEqual({ cents: 1_400_000n, basis: "estimate", year: 2026 });
    expect(ralEstimate([...months(3), extra(2, 90_000n)], employer)?.cents).toBe(1_390_000n);
  });

  it("expects no extra payment from an employer without one", () => {
    const employer = { payFrequency: "monthly" as const, extraMonths: [] };
    expect(ralEstimate(months(3), employer)?.cents).toBe(1_200_000n);
    expect(ralEstimate(months(12), employer)).toEqual({ cents: 1_200_000n, basis: "complete_year", year: 2026 });
  });

  it("calls a year complete only with every extra payment the employer makes", () => {
    const employer = { payFrequency: "monthly" as const, extraMonths: [12, 6] };
    expect(ralEstimate([...months(12), extra(1, 100_000n)], employer)?.basis).toBe("estimate");
    expect(ralEstimate([...months(12), extra(1, 100_000n), extra(2, 50_000n)], employer)).toEqual({
      cents: 1_350_000n,
      basis: "complete_year",
      year: 2026,
    });
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
    expect(valid({ kind: "extra", month: null, extraNumber: 4 })).toBe(false);
  });

  it("refuses a field outside the catalogue and a date that is not one", () => {
    expect(valid({ fields: { madeUp: 1n } })).toBe(false);
    expect(valid({ paidOn: "2026-02-30" })).toBe(false);
  });
});
