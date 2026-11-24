import { describe, expect, it } from "vitest";
import { payroll } from "@ledgerly/api-contract/payroll";
import { type Catalogue, type Format, type Register, registerColumns, registerGroups } from "./present";

const FORMAT: Format = { numberFormat: "it-IT", locale: "en", timeZone: "Europe/Rome" };
const REGISTER = payroll.getPayroll.response.parse(payroll.getPayroll.example?.response) as Register;
const [READ] = REGISTER.years[0].rows;
const PAYSLIP = "11111111-2222-4333-8444-555555555555";

describe("the register's rows (R5g)", () => {
  it("opens a read payslip's review, and a payslip typed by hand on its own page", () => {
    const manual = { ...READ, id: PAYSLIP, payslipId: PAYSLIP, source: "manual" as const, documentId: null, fileName: "" };
    const years = [{ ...REGISTER.years[0], rows: [READ, manual] }];
    const [read, typed] = registerGroups(years, FORMAT)[0].rows;
    expect(read).toMatchObject({ href: `/payroll/${READ.id}`, manual: false });
    expect(typed).toMatchObject({ href: `/payroll/manual/${PAYSLIP}`, manual: true });
  });

  it("badges an extra payment with its number, and an ordinary payslip with nothing", () => {
    const extra = { ...READ, kind: "extra" as const, extraNumber: 2, period: null };
    const [ordinary, second] = registerGroups([{ ...REGISTER.years[0], rows: [READ, extra] }], FORMAT)[0].rows;
    expect(ordinary.badge).toBeNull();
    expect(second.badge).toEqual({ kind: "extra", extraNumber: 2 });
  });

  it("formats every amount the route answers, whatever its key", () => {
    const row = { ...READ, amounts: { ...READ.amounts, aPackField: "12.00" } };
    expect(registerGroups([{ ...REGISTER.years[0], rows: [row] }], FORMAT)[0].rows[0].values.aPackField).toMatch(/^12,00\s€$/u);
  });
});

describe("the register's columns (R5g, E4)", () => {
  const BASE: Catalogue = [
    { key: "gross", group: "compensation", base: true, summed: true },
    { key: "netPay", group: "net", base: true, summed: true },
  ];
  const empty = { ...READ, amounts: { gross: "1.00", netPay: "1.00", irpefGross: null }, leaveLeft: { vacation: null, rol: null, permit: null } };

  it("shows the base fields only, and no details, for a person without a country and nothing more", () => {
    const groups = registerGroups([{ ...REGISTER.years[0], rows: [empty] }], FORMAT);
    expect(registerColumns(BASE, groups)).toEqual({ main: ["gross", "netPay"], extra: [], details: false });
  });

  it("adds the country's summed fields, then any amount a payslip carries, under details", () => {
    const catalogue: Catalogue = [...BASE, { key: "tfrSelected", group: "tfr", base: false, summed: true }];
    const carried = { ...empty, amounts: { ...empty.amounts, irpefGross: "2.00" } };
    const groups = registerGroups([{ ...REGISTER.years[0], rows: [carried] }], FORMAT);
    expect(registerColumns(catalogue, groups)).toEqual({
      main: ["gross", "netPay"],
      extra: ["tfrSelected", "irpefGross"],
      details: true,
    });
  });
});
