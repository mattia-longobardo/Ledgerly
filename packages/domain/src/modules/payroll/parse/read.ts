import type { EvidenceInput } from "../../imports/service";
import {
  boxOf,
  cellsOf,
  labelFor,
  labelKey,
  type Label,
  labelRows,
  type LabelRow,
  parseItalianNumber,
  textOf,
  type Token,
  valueRows,
} from "../../imports/pdf/layout";
import type { PageText } from "../../imports/pdf/text";
import { type CivilDate } from "../../../shared/dates";
import { centsToDecimal, type Cents, parseCents } from "../../../shared/money";
import { FIELDS, type FieldName, isDerived, isFieldName, LEAVE_COLUMNS, leaveField, type MoneyField } from "../fields";
import {
  type CodeRole,
  type LineUnit,
  PAYSLIP_PROFILES,
  parseItalianDate,
  parsePeriodLabel,
  type PayslipIdentity,
  type PayslipProfile,
  ROLE_FIELD,
} from "../rules";
import type { Warning } from "./checks";

/** Confidence of a value read under its own label, of a sum of lines, of a blank box. */
const PRINTED = 0.95;
const SUMMED = 0.9;
const BLANK = 0.9;

interface FieldEvidence extends EvidenceInput {
  field: FieldName;
}

/** A body line as printed (owner's spec L51–54), with the role the code map gives its code. */
export interface RawLine {
  position: number;
  code: string;
  description: string;
  quantity: string | null;
  quantityUnit: LineUnit | null;
  rate: string | null;
  earningsCents: Cents | null;
  deductionsCents: Cents | null;
  statisticalCents: Cents | null;
  page: number;
  bbox: [number, number, number, number];
  rawText: string;
  role: CodeRole;
}

export interface ParsedPayslip {
  recognised: boolean;
  identity: PayslipIdentity | null;
  /** Every field the reader reads, each exactly once, `value: null` when the box is blank. */
  fields: FieldEvidence[];
  lines: RawLine[];
  warnings: Warning[];
  /** Characters of text on every page together: too few and the PDF needs OCR (spec D11). */
  textChars: number;
}

/** A form's text as the reader sees it: labels and values by row, and each value cell by its label. */
interface Form {
  profile: PayslipProfile;
  items: PageText["items"];
  labels: LabelRow[];
  values: ReturnType<typeof valueRows>;
  cellOf: Map<Label, Token[]>;
  firstLabel: (key: string) => Label | null;
  sizeOf: (page: number) => { width: number; height: number };
}

const pattern = (source: string) => new RegExp(source, "i");

function formOf(pages: readonly PageText[], profile: PayslipProfile): Form {
  const items = pages.flatMap((page) => page.items);
  const labels = labelRows(items, profile.geometry);
  const values = valueRows(items, profile.geometry);
  // Every cell of the form, keyed by the label object it sits under.
  const cellOf = new Map<Label, Token[]>();
  for (const row of values) {
    for (const cell of cellsOf(labels, row, profile.geometry)) cellOf.set(cell.label, cell.tokens);
  }
  const firstLabel = (key: string): Label | null => {
    for (const row of labels) {
      const label = row.labels.find((one) => one.key === key);
      if (label) return label;
    }
    return null;
  };
  const sizeOf = (page: number) => pages.find((one) => one.page === page) ?? pages[0];
  return { profile, items, labels, values, cellOf, firstLabel, sizeOf };
}

/** Whether the form prints every marker of the profile. */
function matches(form: Form): boolean {
  return form.profile.markers.every((marker) => form.firstLabel(labelKey(marker)) !== null);
}

/**
 * The profile whose markers the document prints (E1 `detect()`), the first that matches in the
 * order of `profiles`; `null` when none does — a document of an unknown format.
 */
export function detectProfile(
  pages: readonly PageText[],
  profiles: readonly PayslipProfile[] = PAYSLIP_PROFILES,
): PayslipProfile | null {
  return profiles.find((profile) => matches(formOf(pages, profile))) ?? null;
}

/** Every label the profile reads a field under: its summary, then its balances' four columns. */
function summaryOf(profile: PayslipProfile): { field: FieldName; label: string }[] {
  const leave = profile.balances.flatMap((balance) =>
    LEAVE_COLUMNS.map((column, index) => ({ field: leaveField(balance.kind, column), label: balance.labels[index] })),
  );
  return [...profile.summary.flatMap(({ field, label }) => (isFieldName(field) ? [{ field, label }] : [])), ...leave];
}

function cents(text: string): Cents | null {
  const decimal = parseItalianNumber(text);
  if (decimal === null || !/^-?\d+(\.\d{1,2})?$/.test(decimal)) return null;
  return parseCents(decimal);
}

function hoursValue(text: string): string | null {
  const decimal = parseItalianNumber(text);
  if (decimal === null || !/^-?\d+(\.\d{1,2})?$/.test(decimal)) return null;
  return Number(decimal).toFixed(2);
}

const blank = (field: FieldName, sourceLabel: string | null): FieldEvidence => ({
  field,
  value: null,
  unit: FIELDS[field].unit,
  sourceLabel,
  page: null,
  bbox: null,
  origin: "printed",
  confidence: BLANK,
  rawText: null,
});

/** A field printed under its label, as the field's unit reads it. */
function printedField(form: Form, field: FieldName, text: string): FieldEvidence {
  const label = form.firstLabel(labelKey(text));
  const tokens = label ? form.cellOf.get(label) : undefined;
  if (!label || !tokens || tokens.length === 0) return blank(field, label?.text ?? text);
  const raw = textOf(tokens);
  const unit = FIELDS[field].unit;
  const amount = unit === "eur" ? cents(raw) : null;
  const value = unit === "eur" ? (amount === null ? null : centsToDecimal(amount)) : unit === "hours" ? hoursValue(raw) : raw;
  return {
    field,
    value,
    unit,
    sourceLabel: label.text,
    page: tokens[0].page,
    bbox: boxOf(tokens, form.sizeOf(tokens[0].page)),
    origin: "printed",
    // A box with text that is not a number is kept as raw text, with no value and low confidence.
    confidence: value === null ? 0.3 : PRINTED,
    rawText: raw,
  };
}

/** The employer: the company's fiscal code printed in its block, else its payroll code. */
function employerField(form: Form): FieldEvidence {
  const { employer } = form.profile;
  const employerRow = form.values.find((row) => pattern(employer.rowPattern).test(textOf(row.tokens)));
  const employerMatch = employerRow && pattern(employer.taxCodePattern).exec(textOf(employerRow.tokens));
  const companyCode = form.firstLabel(labelKey(employer.companyCodeLabel));
  const companyTokens = companyCode ? form.cellOf.get(companyCode) : undefined;
  if (employerRow && employerMatch) {
    const tokens = employerRow.tokens.filter((token) => token.text.includes(employerMatch[1]));
    return {
      field: "employerKey",
      value: employerMatch[1],
      unit: "text",
      sourceLabel: employer.sourceLabel,
      page: employerRow.page,
      bbox: boxOf(tokens.length > 0 ? tokens : employerRow.tokens, form.sizeOf(employerRow.page)),
      origin: "printed",
      confidence: PRINTED,
      rawText: textOf(employerRow.tokens),
    };
  }
  if (companyCode && companyTokens && companyTokens.length > 0) {
    return {
      field: "employerKey",
      value: `${employer.companyCodePrefix}${textOf(companyTokens)}`,
      unit: "text",
      sourceLabel: companyCode.text,
      page: companyTokens[0].page,
      bbox: boxOf(companyTokens, form.sizeOf(companyTokens[0].page)),
      origin: "printed",
      confidence: PRINTED,
      rawText: textOf(companyTokens),
    };
  }
  return blank("employerKey", employer.sourceLabel);
}

/** The day the payslip was printed, from the line that says so. */
function printedOnField(form: Form): FieldEvidence {
  const { printedOn } = form.profile;
  const printed = form.items.find((item) => pattern(printedOn.pattern).test(item.text));
  const printedMatch = printed && pattern(printedOn.pattern).exec(printed.text);
  const day: CivilDate | null = printedMatch ? parseItalianDate(printedMatch[1]) : null;
  if (!printed || !day) return blank("printedOn", printedOn.sourceLabel);
  return {
    field: "printedOn",
    value: day,
    unit: "date",
    sourceLabel: printedOn.sourceLabel,
    page: printed.page,
    bbox: boxOf([printed], form.sizeOf(printed.page)),
    origin: "printed",
    confidence: PRINTED,
    rawText: printed.text,
  };
}

/** The fields the body lines add up to, through the code map, and the net's two column totals. */
function lineFields(form: Form, lines: readonly RawLine[], fields: Map<FieldName, FieldEvidence>): FieldEvidence[] {
  const out: FieldEvidence[] = [];
  const byField = new Map<MoneyField, RawLine[]>();
  for (const line of lines) {
    const field = ROLE_FIELD[line.role];
    if (field) byField.set(field, [...(byField.get(field) ?? []), line]);
  }
  const fromLines = [...new Set(Object.values(ROLE_FIELD))].filter((field) => !fields.has(field));
  for (const field of fromLines) {
    const found = byField.get(field) ?? [];
    out.push(found.length === 0 ? blank(field, null) : sumOfLines(field, found, found.length === 1 ? PRINTED : SUMMED));
  }
  // The substitute tax is printed twice (body line and T.S. box): counted once (owner's spec L242).
  const substitute = fields.get("substituteTax");
  const substituteLines = lines.filter((line) => line.role === "substitute_tax");
  if (substitute && substitute.value === null && substituteLines.length > 0) {
    out.push(sumOfLines("substituteTax", substituteLines, SUMMED));
  }
  // What the net is reconciled from: every amount in the body's earnings and deductions columns.
  const { headers } = form.profile.body;
  out.push(columnTotal("bodyEarnings", headers.earnings, lines, (line) => line.earningsCents));
  out.push(columnTotal("bodyDeductions", headers.deductions, lines, (line) => line.deductionsCents));
  return out;
}

/**
 * Reads a payslip with a profile (owner's spec, whole): the raw body lines, every field with the
 * box it was read from, and the warnings a person must see. Pure: the PDF's text in, data out.
 * Derived values and checks are computed later, from the fields as corrected. A document the
 * profile does not match is read all the same: `recognised: false`, and its boxes blank.
 */
export function readWithProfile(
  pages: readonly PageText[],
  profile: PayslipProfile,
  codeMap: ReadonlyMap<string, CodeRole>,
): ParsedPayslip {
  const form = formOf(pages, profile);
  const textChars = form.items.reduce((sum, item) => sum + item.text.trim().length, 0);
  const recognised = matches(form);
  const fields = new Map<FieldName, FieldEvidence>();
  const put = (evidence: FieldEvidence) => fields.set(evidence.field, evidence);

  for (const { field, label } of summaryOf(profile)) put(printedField(form, field, label));
  put(employerField(form));
  keepPayrollCode(fields.get("employeeKey"));
  put(printedOnField(form));

  const lines = bodyLines(form, codeMap);
  for (const evidence of lineFields(form, lines, fields)) put(evidence);
  const unread = profile.neverPrinted.filter(isFieldName).filter((field) => !fields.has(field));
  for (const field of unread) put(blank(field, null));

  const periodLabel = fields.get("periodLabel")?.value ?? null;
  const identity = periodLabel === null ? null : parsePeriodLabel(periodLabel);
  const warnings: Warning[] = lines.flatMap((line) =>
    line.role === "other" ? [{ code: "unknown_code", detail: { code: line.code } } as const] : [],
  );
  if (!recognised) warnings.push({ code: "unknown_layout" });
  else if (!identity || !hasKeys(fields)) warnings.push({ code: "missing_identity" });

  return {
    recognised,
    identity,
    fields: [...fields.values()].filter((evidence) => !isDerived(evidence.field)),
    lines,
    warnings,
    textChars,
  };
}

/** The employee is their payroll code: the name and the personal fiscal code are never stored. */
function keepPayrollCode(employee: FieldEvidence | undefined): void {
  if (employee?.value) employee.value = employee.value.split(" ")[0];
}

/** Whether the employer and the employee were read: with the period, a payslip's identity. */
function hasKeys(fields: ReadonlyMap<FieldName, FieldEvidence>): boolean {
  return Boolean(fields.get("employerKey")?.value && fields.get("employeeKey")?.value);
}

function boxAround(lines: readonly RawLine[]): [number, number, number, number] {
  return [
    Math.min(...lines.map((line) => line.bbox[0])),
    Math.min(...lines.map((line) => line.bbox[1])),
    Math.max(...lines.map((line) => line.bbox[2])),
    Math.max(...lines.map((line) => line.bbox[3])),
  ];
}

function sumOfLines(field: MoneyField, lines: readonly RawLine[], confidence: number): FieldEvidence {
  const total = lines.reduce<Cents>(
    (sum, line) => sum + (line.earningsCents ?? line.deductionsCents ?? line.statisticalCents ?? 0n),
    0n,
  );
  return {
    field,
    value: centsToDecimal(total),
    unit: "eur",
    sourceLabel: lines.map((line) => `${line.code} ${line.description}`).join(" + "),
    page: lines[0].page,
    bbox: boxAround(lines.filter((line) => line.page === lines[0].page)),
    origin: lines.length === 1 ? "printed" : "derived",
    confidence,
    rawText: lines.map((line) => line.rawText).join(" | "),
    derivedFrom: lines.length === 1 ? null : lines.map((line) => `line:${line.position}`),
  };
}

function columnTotal(
  field: "bodyEarnings" | "bodyDeductions",
  sourceLabel: string,
  lines: readonly RawLine[],
  amountOf: (line: RawLine) => Cents | null,
): FieldEvidence {
  const counted = lines.filter((line) => amountOf(line) !== null);
  const total = counted.reduce<Cents>((sum, line) => sum + (amountOf(line) ?? 0n), 0n);
  const first = counted[0];
  return {
    field,
    // No body at all is not a body that adds up to zero.
    value: lines.length === 0 ? null : centsToDecimal(total),
    unit: "eur",
    sourceLabel,
    page: first?.page ?? null,
    bbox: first ? boxAround(counted) : null,
    origin: "derived",
    confidence: SUMMED,
    rawText: null,
    derivedFrom: counted.map((line) => `line:${line.position}`),
  };
}

/**
 * The body (owner's spec L26 "corpo voci"): between its header row and the row that closes it, one
 * line per code. A row without a code (a note of the contract) is not a line.
 */
function bodyRows(form: Form, descriptionKey: string) {
  const { body, geometry } = form.profile;
  const header = form.labels.find((row) => row.labels.some((label) => label.key === descriptionKey));
  if (!header) return null;
  const end = form.labels.find(
    (row) => row.page === header.page && row.baseline > header.baseline && row.labels.some((label) => label.key === labelKey(body.end)),
  );
  const rows = form.values.filter(
    (row) => row.page === header.page && row.baseline > header.baseline + geometry.bodyHeaderGap && (!end || row.baseline < end.baseline),
  );
  return { header, rows };
}

/** A body row's tokens by the column header above them; a token left of every header is the code's. */
function columnsOf(tokens: readonly Token[], headers: readonly Label[], codeKey: string): Map<string, Token[]> {
  const columns = new Map<string, Token[]>();
  for (const token of tokens) {
    const column = labelFor(headers, token)?.key ?? codeKey;
    columns.set(column, [...(columns.get(column) ?? []), token]);
  }
  return columns;
}

function bodyLines(form: Form, codeMap: ReadonlyMap<string, CodeRole>): RawLine[] {
  const { body } = form.profile;
  const key = Object.fromEntries(Object.entries(body.headers).map(([name, label]) => [name, labelKey(label)]));
  const found = bodyRows(form, key.description);
  if (!found) return [];
  const lines: RawLine[] = [];
  for (const row of found.rows) {
    const columns = columnsOf(row.tokens, found.header.labels, key.code);
    const left = [...(columns.get(key.code) ?? []), ...(columns.get(key.description) ?? [])];
    const [first, ...rest] = left;
    if (!first || !pattern(body.codePattern).test(first.text)) continue;
    const description = textOf(rest);
    const read = <T>(column: string, parse: (text: string) => T | null) => {
      const tokens = columns.get(column);
      return tokens && tokens.length > 0 ? parse(textOf(tokens)) : null;
    };
    lines.push({
      position: lines.length + 1,
      code: first.text,
      description,
      quantity: read(key.quantity, parseItalianNumber),
      quantityUnit: body.units.find((unit) => pattern(unit.pattern).test(description))?.unit ?? null,
      rate: read(key.rate, parseItalianNumber),
      earningsCents: read(key.earnings, cents),
      deductionsCents: read(key.deductions, cents),
      statisticalCents: read(key.statistical, cents),
      page: row.page,
      bbox: boxOf(row.tokens, form.sizeOf(row.page)),
      rawText: textOf(row.tokens),
      role: codeMap.get(first.text) ?? "other",
    });
  }
  return lines;
}
