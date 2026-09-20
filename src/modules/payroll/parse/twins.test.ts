// The synthetic twins (spec §11) through the same code the owner's payslips go through: they keep
// the parser tested once `Payroll/` is deleted.
import { beforeAll, describe, expect, it } from "vitest";
import { readPdfText } from "@/modules/imports/pdf/text";
import {
  APRIL,
  MARCH,
  MARCH_UNKNOWN_CODE,
  THIRTEENTH,
} from "../../../../tests/fixtures/payroll/samples";
import { twinPdf, type TwinPayslip } from "../../../../tests/fixtures/payroll/twin";
import { REPLY_TEAMSYSTEM_CODES } from "../rules";
import { assemble } from "./assemble";
import { hasBlockingFailure } from "./checks";
import { parseReplyTeamsystem, type ParsedPayslip } from "./reply-teamsystem";

const codeMap = new Map(REPLY_TEAMSYSTEM_CODES.map((entry) => [entry.code, entry.role]));
const read = async (twin: TwinPayslip) => parseReplyTeamsystem(await readPdfText(await twinPdf(twin)), codeMap);
const valuesOf = (parsed: ParsedPayslip) => Object.fromEntries(parsed.fields.map((field) => [field.field, field.value]));

let march: ParsedPayslip;
let april: ParsedPayslip;
let thirteenth: ParsedPayslip;

beforeAll(async () => {
  [march, april, thirteenth] = await Promise.all([read(MARCH), read(APRIL), read(THIRTEENTH)]);
});

describe("reading a twin (spec §7.8 steps 2–5)", () => {
  it("finds the identity from MESE RETRIBUITO, the employer's code and the employee's payroll code", () => {
    expect(march.recognised).toBe(true);
    expect(march.identity).toEqual({ type: "ordinary", year: 2031, period: "2031-03-01" });
    const values = valuesOf(march);
    expect(values).toMatchObject({
      periodLabel: "MARZO 2031",
      employerKey: "01234567890",
      employeeKey: "901",
      printedOn: "2031-03-27",
    });
    // The employee's name is on the form, and never stored.
    expect(JSON.stringify(march.fields)).not.toContain("ROSSI");
  });

  it("reads the month's IRPEF boxes, not the yearly progressives printed under the same labels", () => {
    expect(valuesOf(march)).toMatchObject({
      irpefTaxable: "1816.20",
      irpefGross: "417.73",
      taxDeductions: "150.00",
      irpefWithheld: "267.73",
    });
  });

  it("reads each body line into its column, keeping the sign, the rate and the unit", () => {
    expect(march.lines.map((line) => [line.code, line.role])).toEqual([
      ["2", "ordinary_earnings"],
      ["300", "vacation_offset"],
      ["301", "vacation_event"],
      ["1150", "regional_installment"],
      ["7101", "employee_fund"],
      ["8003", "tfr_contribution"],
      ["9109", "employer_fund"],
      ["9110", "statistical"],
      ["9838", "substitute_tax"],
    ]);
    expect(march.lines[1]).toMatchObject({
      quantity: "8.00",
      quantityUnit: "hours",
      rate: "-11.56069",
      earningsCents: -9249n,
      deductionsCents: null,
    });
    expect(march.lines[0]).toMatchObject({ quantityUnit: "months", earningsCents: 200_000n });
    expect(march.lines[5]).toMatchObject({ statisticalCents: 15_000n, earningsCents: null });
  });

  it("gives every printed value its page and box, and every blank box a null (never a zero)", () => {
    for (const field of march.fields) {
      if (field.value === null) {
        expect(field.bbox).toBeNull();
        continue;
      }
      expect(field.page).toBe(1);
      expect(field.bbox).toHaveLength(4);
      const [x0, y0, x1, y1] = field.bbox!;
      expect(x0).toBeLessThan(x1);
      expect(y0).toBeLessThan(y1);
    }
    const values = valuesOf(march);
    expect(values.vacationUsed).toBeNull();
    expect(values.yearEndAdjustment).toBeNull();
    expect(values.employerSocialTotal).toBeNull();
  });

  it("does not store derived values as read ones", () => {
    const fields = march.fields.map((field) => field.field);
    expect(fields).not.toContain("gross");
    expect(fields).not.toContain("taxesTotal");
    expect(fields).toContain("netPay");
  });
});

describe("assembling a twin (derived values, checks, leave)", () => {
  it("derives gross, taxes and fund, and passes every check of an ordinary month", () => {
    const assembled = assemble({
      type: "ordinary",
      period: "2031-03-01",
      values: valuesOf(march),
      lines: march.lines,
      previous: null,
      history: [],
    });
    expect(assembled.values).toMatchObject({
      gross: "2000.00",
      taxesTotal: "280.23",
      taxesNetOfRefunds: "280.23",
      employeeFundEffective: "25.00",
      employerFundEffective: "45.00",
      tfrSelected: "150.00",
      tfrSource: "contribution_line",
    });
    expect(hasBlockingFailure(assembled.checks)).toBe(false);
    expect(Object.fromEntries(assembled.checks.map((check) => [check.id, check.status]))).toMatchObject({
      irpef: "passed",
      net: "passed",
      body_deductions: "passed",
      total_deductions: "passed",
      substitute_tax: "passed",
      leave_vacation: "passed",
      leave_rol: "passed",
      leave_permit: "skipped",
      plausibility_net: "skipped",
    });
    expect(assembled.events).toEqual([{ kind: "vacation", hours: "8.00", linePositions: [3] }]);
  });

  it("fails the net check on a corrected net that no longer reconciles, and says by how much", () => {
    const assembled = assemble({
      type: "ordinary",
      period: "2031-03-01",
      values: { ...valuesOf(march), netPay: "1512.00" },
      lines: march.lines,
      previous: null,
      history: [],
    });
    expect(assembled.checks.find((check) => check.id === "net")).toEqual({
      id: "net",
      severity: "error",
      status: "failed",
      expected: "1511.00",
      actual: "1512.00",
    });
    expect(hasBlockingFailure(assembled.checks)).toBe(true);
  });

  it("counts a permit as ROL only when the ROL balance, from the payslip before, confirms it", () => {
    const march_ = assemble({
      type: "ordinary",
      period: "2031-03-01",
      values: valuesOf(march),
      lines: march.lines,
      previous: null,
      history: [],
    });
    const confirmed = assemble({
      type: "ordinary",
      period: "2031-04-01",
      values: valuesOf(april),
      lines: april.lines,
      previous: { period: "2031-03-01", values: march_.values },
      history: [],
    });
    expect(confirmed.events).toEqual([{ kind: "rol", hours: "4.00", linePositions: [3] }]);
    expect(confirmed.warnings).toEqual([]);

    const unknown = assemble({
      type: "ordinary",
      period: "2031-04-01",
      values: valuesOf(april),
      lines: april.lines,
      previous: null,
      history: [],
    });
    expect(unknown.events).toEqual([{ kind: "permit", hours: "4.00", linePositions: [3] }]);
    expect(unknown.warnings).toEqual([{ code: "permit_unclassified", detail: { hours: "4.00" } }]);
  });

  it("reads the 13th as its own type, with no month, no leave, and no employer amount of its own", () => {
    expect(thirteenth.identity).toEqual({ type: "thirteenth", year: 2031, period: null });
    const assembled = assemble({
      type: "thirteenth",
      period: null,
      values: valuesOf(thirteenth),
      lines: thirteenth.lines,
      previous: null,
      history: [],
    });
    expect(assembled.values).toMatchObject({
      employeeFundRegular: "25.00",
      employeeFundAdjustments: "-20.00",
      employeeFundEffective: "5.00",
      employerFundEffective: null,
      taxesTotal: "104.43",
    });
    // An extra month carrying only the adjustment is the ordinary shape of a 13th: no remark.
    expect(assembled.warnings.map((warning) => warning.code)).toEqual([]);
    expect(assembled.checks.find((check) => check.id === "irpef")).toMatchObject({ status: "skipped", reason: "extra_month" });
    expect(assembled.checks.find((check) => check.id === "net")?.status).toBe("passed");
    expect(assembled.events).toEqual([]);
  });

  it("warns about net and gross far from the person's recent months, without blocking", () => {
    const assembled = assemble({
      type: "ordinary",
      period: "2031-03-01",
      values: valuesOf(march),
      lines: march.lines,
      previous: null,
      history: [1, 2].map((month) => ({ period: `2031-0${month}-01`, netPay: 250_000n, gross: 200_000n })),
    });
    expect(assembled.checks.find((check) => check.id === "plausibility_net")).toMatchObject({
      status: "failed",
      severity: "warning",
      expected: "2500.00",
      actual: "1511.00",
    });
    expect(assembled.checks.find((check) => check.id === "plausibility_gross")?.status).toBe("passed");
    expect(hasBlockingFailure(assembled.checks)).toBe(false);
  });
});

it("flags a code the map does not know, and keeps its line", async () => {
  const parsed = await read(MARCH_UNKNOWN_CODE);
  expect(parsed.warnings).toContainEqual({ code: "unknown_code", detail: { code: "5555" } });
  expect(parsed.lines.at(-1)).toMatchObject({ code: "5555", role: "other", statisticalCents: 100n });
});

it("does not recognise a PDF that is not this form", async () => {
  const { PDFDocument, StandardFonts } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  const page = pdf.addPage();
  page.drawText("Fattura n. 12 del 2031 — importo 100,00", { x: 50, y: 700, size: 10, font: await pdf.embedFont(StandardFonts.Courier) });
  const parsed = parseReplyTeamsystem(await readPdfText(await pdf.save()), codeMap);
  expect(parsed.recognised).toBe(false);
  expect(parsed.warnings).toContainEqual({ code: "unknown_layout" });
  expect(parsed.fields.every((field) => field.value === null || field.field === "printedOn")).toBe(true);
});
