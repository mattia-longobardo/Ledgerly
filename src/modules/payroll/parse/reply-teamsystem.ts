import type { EvidenceInput } from "@/modules/imports/service";
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
} from "@/modules/imports/pdf/layout";
import type { PageText } from "@/modules/imports/pdf/text";
import { type CivilDate } from "@/platform/dates";
import { centsToDecimal, type Cents, parseCents } from "@/platform/money";
import { FIELDS, type FieldName, isDerived, type MoneyField } from "../fields";
import {
  type CodeRole,
  type LineUnit,
  parseItalianDate,
  parsePeriodLabel,
  type PayslipIdentity,
  ROLE_FIELD,
} from "../rules";
import type { Warning } from "./checks";

/** Bumped whenever a change would read the same PDF differently; stored on each document. */
export const PARSER_VERSION = "reply-teamsystem@1";

/** Confidence of a value read under its own label, of a sum of lines, of a blank box. */
const PRINTED = 0.95;
const SUMMED = 0.9;
const BLANK = 0.9;

export interface FieldEvidence extends EvidenceInput {
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
  /** Every field the parser reads, each exactly once, `value: null` when the box is blank. */
  fields: FieldEvidence[];
  lines: RawLine[];
  warnings: Warning[];
  /** Characters of text on every page together: too few and the PDF needs OCR (spec D11). */
  textChars: number;
}

/**
 * Where each field is printed on the Reply/TeamSystem form ("«Mod. Cedolino TS»"), by label (owner's
 * spec L91–182). Labels are compared by `labelKey`: no spaces, no dots. A label that the form
 * prints twice (the month's IRPEF box and the yearly progressives) is the first from the top.
 */
const SUMMARY: readonly { field: FieldName; label: string }[] = [
  { field: "periodLabel", label: "MESE RETRIBUITO" },
  { field: "employeeKey", label: "CODICE" },
  { field: "contractualGross", label: "RETRIBUZIONE DI FATTO" },
  { field: "totalGrossPrinted", label: "TOTALE LORDO" },
  { field: "employeeSocial", label: "TOTALE CONTRIBUTI SOCIALI" },
  { field: "substituteTax", label: "TOTALE TRATTENUTE IRPEF T.S." },
  { field: "irpefTaxable", label: "IMPONIBILE IRPEF" },
  { field: "irpefGross", label: "IRPEF LORDA" },
  { field: "taxDeductions", label: "TOTALE DETRAZIONI" },
  { field: "irpefWithheld", label: "TOTALE TRATTENUTE IRPEF" },
  { field: "roundingPrevious", label: "ARROTOND. PRECED." },
  { field: "bodyDeductionsPrinted", label: "TRATTENUTE CORPO" },
  { field: "totalDeductionsPrinted", label: "TOTALE TRATTENUTE" },
  { field: "yearEndAdjustment", label: "CONGUAGLIO IRPEF +/-" },
  { field: "roundingCurrent", label: "ARROTONDAMENTO ATTUALE" },
  { field: "netPay", label: "NETTO BUSTA" },
  { field: "tfrMonthField", label: "TFR MESE" },
  { field: "vacationPreviousYear", label: "FERIE A.P." },
  { field: "vacationAccrued", label: "FERIE MAT." },
  { field: "vacationUsed", label: "FERIE GOD." },
  { field: "vacationRemaining", label: "FERIE RES." },
  { field: "permitPreviousYear", label: "PERMESSI A.P." },
  { field: "permitAccrued", label: "PERMESSI MAT." },
  { field: "permitUsed", label: "PERMESSI GOD." },
  { field: "permitRemaining", label: "PERMESSI RES." },
  { field: "rolPreviousYear", label: "ROL A.P." },
  { field: "rolAccrued", label: "ROL MAT." },
  { field: "rolUsed", label: "ROL. GOD." },
  { field: "rolRemaining", label: "ROL. RES." },
];

/** The body's column headers (owner's spec L26 "corpo voci"). */
const BODY = {
  code: labelKey("CODICE"),
  description: labelKey("DESCRIZIONE VOCE"),
  quantity: labelKey("ORE/GIORNI"),
  rate: labelKey("BASE"),
  earnings: labelKey("COMPETENZE"),
  deductions: labelKey("TRATTENUTE"),
  statistical: labelKey("DATI STATISTICI"),
} as const;

/** Fields no label or line of this form ever shows: `null`, never zero (owner's spec L143). */
const NEVER_PRINTED: readonly FieldName[] = ["employerSocialTotal", "municipalWithheld"];

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

function unitOf(description: string): LineUnit | null {
  if (/\(hh\)/i.test(description)) return "hours";
  if (/\(gg\)/i.test(description)) return "days";
  if (/\(mens\.?\)/i.test(description)) return "months";
  return null;
}

/**
 * Reads a Reply/TeamSystem payslip (owner's spec, whole): the raw body lines, every field with the
 * box it was read from, and the warnings a person must see. Pure: the PDF's text in, data out.
 * Derived values and checks are computed later, from the fields as corrected.
 */
export function parseReplyTeamsystem(
  pages: readonly PageText[],
  codeMap: ReadonlyMap<string, CodeRole>,
): ParsedPayslip {
  const items = pages.flatMap((page) => page.items);
  const textChars = items.reduce((sum, item) => sum + item.text.trim().length, 0);
  const sizeOf = (page: number) => pages.find((one) => one.page === page) ?? pages[0];
  const labels = labelRows(items);
  const values = valueRows(items);
  const warnings: Warning[] = [];

  // Every cell of the form, keyed by the label object it sits under.
  const cellOf = new Map<Label, Token[]>();
  for (const row of values) {
    for (const cell of cellsOf(labels, row)) cellOf.set(cell.label, cell.tokens);
  }
  const firstLabel = (key: string): Label | null => {
    for (const row of labels) {
      const label = row.labels.find((one) => one.key === key);
      if (label) return label;
    }
    return null;
  };

  const recognised = firstLabel(labelKey("NETTO BUSTA")) !== null && firstLabel(labelKey("MESE RETRIBUITO")) !== null;
  const fields = new Map<FieldName, FieldEvidence>();
  const put = (evidence: FieldEvidence) => fields.set(evidence.field, evidence);

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

  for (const { field, label: text } of SUMMARY) {
    const label = firstLabel(labelKey(text));
    const tokens = label ? cellOf.get(label) : undefined;
    if (!label || !tokens || tokens.length === 0) {
      put(blank(field, label?.text ?? text));
      continue;
    }
    const raw = textOf(tokens);
    const unit = FIELDS[field].unit;
    const value =
      unit === "eur"
        ? (() => {
            const amount = cents(raw);
            return amount === null ? null : centsToDecimal(amount);
          })()
        : unit === "hours"
          ? hoursValue(raw)
          : raw;
    put({
      field,
      value,
      unit,
      sourceLabel: label.text,
      page: tokens[0].page,
      bbox: boxOf(tokens, sizeOf(tokens[0].page)),
      origin: "printed",
      // A box with text that is not a number is kept as raw text, with no value and low confidence.
      confidence: value === null ? 0.3 : PRINTED,
      rawText: raw,
    });
  }

  // The employer: the company's fiscal code printed in the "Ditta" block, else its payroll code.
  const employerRow = values.find((row) => /Cod\.?\s*fiscale/i.test(textOf(row.tokens)));
  const employerMatch = employerRow && /Cod\.?\s*fiscale\s*:\s*([0-9A-Z]{11,16})/i.exec(textOf(employerRow.tokens));
  const companyCode = firstLabel(labelKey("COD. AZIENDA"));
  const companyTokens = companyCode ? cellOf.get(companyCode) : undefined;
  if (employerRow && employerMatch) {
    const tokens = employerRow.tokens.filter((token) => token.text.includes(employerMatch[1]));
    put({
      field: "employerKey",
      value: employerMatch[1],
      unit: "text",
      sourceLabel: "Cod.fiscale",
      page: employerRow.page,
      bbox: boxOf(tokens.length > 0 ? tokens : employerRow.tokens, sizeOf(employerRow.page)),
      origin: "printed",
      confidence: PRINTED,
      rawText: textOf(employerRow.tokens),
    });
  } else if (companyCode && companyTokens && companyTokens.length > 0) {
    put({
      field: "employerKey",
      value: `az:${textOf(companyTokens)}`,
      unit: "text",
      sourceLabel: companyCode.text,
      page: companyTokens[0].page,
      bbox: boxOf(companyTokens, sizeOf(companyTokens[0].page)),
      origin: "printed",
      confidence: PRINTED,
      rawText: textOf(companyTokens),
    });
  } else {
    put(blank("employerKey", "Cod.fiscale"));
  }

  // The employee is their payroll code; the name and the personal fiscal code are never stored.
  const employee = fields.get("employeeKey");
  if (employee?.value) employee.value = employee.value.split(" ")[0];

  const printed = items.find((item) => /stampato il\s+\d{2}\/\d{2}\/\d{2,4}/i.test(item.text));
  const printedMatch = printed && /stampato il\s+(\d{2}\/\d{2}\/\d{2,4})/i.exec(printed.text);
  const printedOn: CivilDate | null = printedMatch ? parseItalianDate(printedMatch[1]) : null;
  put(
    printed && printedOn
      ? {
          field: "printedOn",
          value: printedOn,
          unit: "date",
          sourceLabel: "stampato il",
          page: printed.page,
          bbox: boxOf([printed], sizeOf(printed.page)),
          origin: "printed",
          confidence: PRINTED,
          rawText: printed.text,
        }
      : blank("printedOn", "stampato il"),
  );

  const lines = bodyLines(labels, values, codeMap, sizeOf);
  for (const line of lines) {
    if (line.role === "other") warnings.push({ code: "unknown_code", detail: { code: line.code } });
  }

  // Fields the body lines add up to, through the code map.
  const byField = new Map<MoneyField, RawLine[]>();
  for (const line of lines) {
    const field = ROLE_FIELD[line.role];
    if (field) byField.set(field, [...(byField.get(field) ?? []), line]);
  }
  const lineFields = [...new Set(Object.values(ROLE_FIELD))].filter((field) => !fields.has(field));
  for (const field of lineFields) {
    const found = byField.get(field) ?? [];
    if (found.length === 0) {
      put(blank(field, null));
      continue;
    }
    put(sumOfLines(field, found, found.length === 1 ? PRINTED : SUMMED));
  }

  // The substitute tax is printed twice (body line and T.S. box): counted once (owner's spec L242).
  const substitute = fields.get("substituteTax");
  const substituteLines = lines.filter((line) => line.role === "substitute_tax");
  if (substitute && substitute.value === null && substituteLines.length > 0) {
    put(sumOfLines("substituteTax", substituteLines, SUMMED));
  }

  // What the net is reconciled from: every amount in the body's earnings and deductions columns.
  put(columnTotal("bodyEarnings", lines, (line) => line.earningsCents));
  put(columnTotal("bodyDeductions", lines, (line) => line.deductionsCents));

  for (const field of NEVER_PRINTED) if (!fields.has(field)) put(blank(field, null));

  const periodLabel = fields.get("periodLabel")?.value ?? null;
  const identity = periodLabel === null ? null : parsePeriodLabel(periodLabel);
  if (!recognised) warnings.push({ code: "unknown_layout" });
  else if (!identity || !fields.get("employerKey")?.value || !fields.get("employeeKey")?.value) {
    warnings.push({ code: "missing_identity" });
  }

  return {
    recognised,
    identity,
    fields: [...fields.values()].filter((evidence) => !isDerived(evidence.field)),
    lines,
    warnings,
    textChars,
  };
}

function sumOfLines(field: MoneyField, lines: readonly RawLine[], confidence: number): FieldEvidence {
  const total = lines.reduce<Cents>(
    (sum, line) => sum + (line.earningsCents ?? line.deductionsCents ?? line.statisticalCents ?? 0n),
    0n,
  );
  const samePage = lines.filter((line) => line.page === lines[0].page);
  return {
    field,
    value: centsToDecimal(total),
    unit: "eur",
    sourceLabel: lines.map((line) => `${line.code} ${line.description}`).join(" + "),
    page: lines[0].page,
    bbox: [
      Math.min(...samePage.map((line) => line.bbox[0])),
      Math.min(...samePage.map((line) => line.bbox[1])),
      Math.max(...samePage.map((line) => line.bbox[2])),
      Math.max(...samePage.map((line) => line.bbox[3])),
    ],
    origin: lines.length === 1 ? "printed" : "derived",
    confidence,
    rawText: lines.map((line) => line.rawText).join(" | "),
    derivedFrom: lines.length === 1 ? null : lines.map((line) => `line:${line.position}`),
  };
}

function columnTotal(
  field: "bodyEarnings" | "bodyDeductions",
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
    sourceLabel: field === "bodyEarnings" ? "COMPETENZE" : "TRATTENUTE",
    page: first?.page ?? null,
    bbox: first
      ? [
          Math.min(...counted.map((line) => line.bbox[0])),
          Math.min(...counted.map((line) => line.bbox[1])),
          Math.max(...counted.map((line) => line.bbox[2])),
          Math.max(...counted.map((line) => line.bbox[3])),
        ]
      : null,
    origin: "derived",
    confidence: SUMMED,
    rawText: null,
    derivedFrom: counted.map((line) => `line:${line.position}`),
  };
}

/**
 * The body (owner's spec L26 "corpo voci"): between its header row and the TOTALE LORDO row, one
 * line per code. A row without a numeric code (the CCNL note) is not a line.
 */
function bodyLines(
  labels: readonly LabelRow[],
  values: ReturnType<typeof valueRows>,
  codeMap: ReadonlyMap<string, CodeRole>,
  sizeOf: (page: number) => { width: number; height: number },
): RawLine[] {
  const header = labels.find((row) => row.labels.some((label) => label.key === BODY.description));
  if (!header) return [];
  const end = labels.find(
    (row) => row.page === header.page && row.baseline > header.baseline && row.labels.some((label) => label.key === labelKey("TOTALE LORDO")),
  );
  const rows = values.filter(
    (row) => row.page === header.page && row.baseline > header.baseline + 5 && (!end || row.baseline < end.baseline),
  );
  const lines: RawLine[] = [];
  for (const row of rows) {
    const columns = new Map<string, Token[]>();
    for (const token of row.tokens) {
      const label = labelFor(header.labels, token);
      const key = label?.key ?? BODY.code;
      columns.set(key, [...(columns.get(key) ?? []), token]);
    }
    const left = [...(columns.get(BODY.code) ?? []), ...(columns.get(BODY.description) ?? [])];
    const [first, ...rest] = left;
    if (!first || !/^\d{1,6}$/.test(first.text)) continue;
    const description = textOf(rest);
    const amount = (key: string) => {
      const tokens = columns.get(key);
      return tokens && tokens.length > 0 ? cents(textOf(tokens)) : null;
    };
    const decimal = (key: string) => {
      const tokens = columns.get(key);
      return tokens && tokens.length > 0 ? parseItalianNumber(textOf(tokens)) : null;
    };
    lines.push({
      position: lines.length + 1,
      code: first.text,
      description,
      quantity: decimal(BODY.quantity),
      quantityUnit: unitOf(description),
      rate: decimal(BODY.rate),
      earningsCents: amount(BODY.earnings),
      deductionsCents: amount(BODY.deductions),
      statisticalCents: amount(BODY.statistical),
      page: row.page,
      bbox: boxOf(row.tokens, sizeOf(row.page)),
      rawText: textOf(row.tokens),
      role: codeMap.get(first.text) ?? "other",
    });
  }
  return lines;
}

