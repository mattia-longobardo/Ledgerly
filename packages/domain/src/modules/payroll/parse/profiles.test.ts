// The payslip profiles as data (R5g, E1): the first profile reads every twin exactly as the code
// written for its form did, and a second form is read by adding a JSON file only.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { readPdfText } from "../../imports/pdf/text";
import readings from "../../../../../../test/fixtures/payroll/readings.json";
import secondForm from "../../../../../../test/fixtures/payroll/profiles/second-form.json";
import * as samples from "../../../../../../test/fixtures/payroll/samples";
import { twinPdf } from "../../../../../../test/fixtures/payroll/twin";
import { isFieldName } from "../fields";
import { CODE_ROLES, DEFAULT_PROFILE, PAYSLIP_PROFILES } from "../rules";
import { parseProfile } from "../rules/profiles";
import { assemble } from "./assemble";
import { detectProfile, readWithProfile } from "./read";

const plain = (value: unknown): unknown =>
  JSON.parse(JSON.stringify(value, (_key, item: unknown) => (typeof item === "bigint" ? `${item}n` : item)));

/** Each twin with the twin before it (the month before, same employee): what confirms a permit. */
const TWINS = [
  ["JANUARY", null],
  ["FEBRUARY", "JANUARY"],
  ["MARCH", "FEBRUARY"],
  ["APRIL", "MARCH"],
  ["MARCH_REPRINT", "FEBRUARY"],
  ["MARCH_UNKNOWN_CODE", "FEBRUARY"],
  ["THIRTEENTH", null],
] as const;

describe("the first profile", () => {
  it("reads every twin as the code for its form did, field by field (readings.json, captured before R5g)", async () => {
    const codeMap = new Map(DEFAULT_PROFILE.codes.map((entry) => [entry.code, entry.role]));
    const out: Record<string, unknown> = {};
    const valuesBy: Record<string, { period: string | null; values: Record<string, string | null> }> = {};
    for (const [name, before] of TWINS) {
      const pages = await readPdfText(await twinPdf(samples[name]));
      const profile = detectProfile(pages);
      expect(profile?.id).toBe(DEFAULT_PROFILE.id);
      const parsed = readWithProfile(pages, DEFAULT_PROFILE, codeMap);
      const values = Object.fromEntries(parsed.fields.map((field) => [field.field, field.value]));
      const previous = before ? valuesBy[before] : null;
      const assembled = assemble({
        profile: DEFAULT_PROFILE,
        type: parsed.identity!.type,
        period: parsed.identity!.period,
        values,
        lines: parsed.lines,
        previous: previous?.period ? { period: previous.period, values: previous.values } : null,
        history: [],
      });
      valuesBy[name] = { period: parsed.identity!.period, values: assembled.values };
      out[name] = plain({
        parsed: { ...parsed, fields: parsed.fields.toSorted((a, b) => a.field.localeCompare(b.field)) },
        assembled: {
          values: assembled.values,
          checks: assembled.checks,
          events: assembled.events,
          warnings: assembled.warnings,
        },
      });
    }
    expect(out).toEqual(readings);
  });

  it("keeps the version stored on the documents it read", () => {
    expect(DEFAULT_PROFILE.parserVersion).toBe("reply-teamsystem@1");
    expect(DEFAULT_PROFILE.absenceLagMonths).toBe(1);
  });
});

describe("every profile's data", () => {
  it.each(PAYSLIP_PROFILES.map((profile) => [profile.id, profile] as const))("%s names what the code knows", (_id, profile) => {
    for (const { field } of [...profile.summary, ...profile.prompt[profile.language].definitions]) {
      expect(isFieldName(field), field).toBe(true);
    }
    for (const field of profile.neverPrinted) expect(isFieldName(field), field).toBe(true);
    expect(new Set(profile.codes.map((entry) => entry.code)).size).toBe(profile.codes.length);
    expect(profile.codes.every((entry) => CODE_ROLES.includes(entry.role))).toBe(true);
  });
});

/** A one-page form that is not the first profile's: its labels in 5 pt, its values in 10 pt. */
async function secondFormPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.88]);
  const [label, value] = await Promise.all([pdf.embedFont(StandardFonts.Helvetica), pdf.embedFont(StandardFonts.Courier)]);
  const draw = (text: string, x: number, top: number, size: number) =>
    page.drawText(text, { x, y: 841.88 - top, size, font: size > 7 ? value : label });
  draw("PAY PERIOD", 27, 100, 5);
  draw("EMPLOYEE NO.", 200, 100, 5);
  draw("MARZO 2031", 27, 115, 10);
  draw("777 BIANCHI", 200, 115, 10);
  draw("NET PAY", 450, 600, 5);
  draw("1.234,56", 450, 615, 10);
  return pdf.save();
}

describe("a profile added as a data file only", () => {
  const second = parseProfile(secondForm);

  it("is picked by detect for its own form, and not for the first one's", async () => {
    const pages = await readPdfText(await secondFormPdf());
    expect(detectProfile(pages)).toBeNull();
    expect(detectProfile(pages, [...PAYSLIP_PROFILES, second])?.id).toBe(second.id);
    const twin = await readPdfText(await twinPdf(samples.MARCH));
    expect(detectProfile(twin, [second, ...PAYSLIP_PROFILES])?.id).toBe(DEFAULT_PROFILE.id);
  });

  it("is read by the same reader, with its own labels", async () => {
    const parsed = readWithProfile(await readPdfText(await secondFormPdf()), second, new Map());
    const values = Object.fromEntries(parsed.fields.map((field) => [field.field, field.value]));
    expect(parsed.recognised).toBe(true);
    expect(parsed.identity).toEqual({ type: "ordinary", year: 2031, period: "2031-03-01" });
    expect(values).toMatchObject({ periodLabel: "MARZO 2031", employeeKey: "777", netPay: "1234.56" });
    expect(parsed.fields.find((field) => field.field === "netPay")?.sourceLabel).toBe("NET PAY");
  });
});
