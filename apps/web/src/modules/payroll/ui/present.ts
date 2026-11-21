// What the Payroll screens show, from the answers of `/api/v1` (rewrite plan R3): every figure is a
// field of the route, as a decimal string; here it is only formatted.
import { FIELD_GROUPS, SUMMED_FIELDS } from "@ledgerly/api-contract/payroll";
import type { payroll } from "@ledgerly/api-contract/payroll";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY, type NumberFormat, type UiLocale } from "@ledgerly/format/format";
import type { StatusTone } from "@ledgerly/ui/status-badge";

export type Register = RouteOutput<typeof payroll.getPayroll>;
export type Review = RouteOutput<typeof payroll.getPayslip>;
type RegisterRow = Register["years"][number]["rows"][number];
type ReviewField = Review["fields"][number];
export type DocumentState = Review["document"]["state"];
export type FieldGroup = ReviewField["group"];
export type SummedField = (typeof SUMMED_FIELDS)[number];
type Amounts = Record<SummedField, string | null>;

export interface Format {
  numberFormat: NumberFormat;
  locale: UiLocale;
  timeZone: string;
}

/** The tone of each state of a payslip's document: the one map of this area (audit UI-PAY-4). */
export const STATE_TONE: Record<DocumentState, StatusTone> = {
  received: "neutral",
  scanning: "neutral",
  extracting: "neutral",
  needs_review: "warn",
  needs_ocr: "neg",
  verified: "accent",
  applied: "pos",
  superseded: "neutral",
  rejected: "neutral",
  failed: "neg",
};

const DECIMAL = /^-?\d+(\.\d{1,2})?$/;

/** An amount of the wire, formatted; anything that is not a decimal is the empty mark. */
export function moneyOf(value: string | null | undefined, format: Format): string {
  return value && DECIMAL.test(value) ? formatMoney(parseCents(value), format.numberFormat) : NULL_DISPLAY;
}

/** Hours of the wire ("12.50") as the person writes a number, without the unit. */
export function hoursOf(value: string, format: Format): string {
  return formatAmountInput(parseCents(value), format.numberFormat);
}

/** A value of the review as the person reads it: money, hours, a date, or the text itself. */
function displayValue(unit: ReviewField["unit"], value: string | null, format: Format): string {
  if (value === null) return NULL_DISPLAY;
  if (unit === "eur") return DECIMAL.test(value) ? formatMoney(parseCents(value), format.numberFormat) : value;
  if (unit === "hours") return DECIMAL.test(value) ? `${hoursOf(value, format)} h` : value;
  if (unit === "date") return formatDate(value, "long", format.locale);
  return value;
}

/** A value of the review as the person would type it into the correction field. */
function inputValue(unit: ReviewField["unit"], value: string | null, format: Format): string {
  if (value === null) return "";
  return unit === "eur" || unit === "hours" ? hoursOf(value, format) : value;
}

export interface FieldView {
  field: string;
  derived: boolean;
  value: string;
  input: string;
  original: string | null;
  origin: ReviewField["origin"];
  verification: ReviewField["verification"];
  confidence: number;
  sourceLabel: string | null;
  derivedFrom: string[];
  page: number | null;
  bbox: [number, number, number, number] | null;
  unit: ReviewField["unit"];
}

/** The contract holds a box to four numbers. */
function boxOf(bbox: readonly number[] | null): FieldView["bbox"] {
  if (!bbox) return null;
  const [left = 0, top = 0, right = 0, bottom = 0] = bbox;
  return [left, top, right, bottom];
}

function fieldView(row: ReviewField, format: Format): FieldView {
  return {
    field: row.field,
    derived: row.derived,
    value: displayValue(row.unit, row.value, format),
    input: inputValue(row.unit, row.value, format),
    original: row.verification === "corrected" ? displayValue(row.unit, row.read, format) : null,
    origin: row.origin,
    verification: row.verification,
    confidence: row.confidence,
    sourceLabel: row.sourceLabel,
    derivedFrom: row.derivedFrom,
    page: row.page,
    bbox: boxOf(row.bbox),
    unit: row.unit,
  };
}

/** The review's fields by group, in the catalogue's order (spec §7.8): the route's order. */
export function fieldGroups(fields: readonly ReviewField[], format: Format): { group: FieldGroup; fields: FieldView[] }[] {
  return FIELD_GROUPS.map((group) => ({
    group,
    fields: fields.filter((row) => row.group === group).map((row) => fieldView(row, format)),
  })).filter((group) => group.fields.length > 0);
}

export interface RegisterCells {
  id: string;
  href: string;
  month: string;
  badge: Exclude<RegisterRow["type"], "ordinary"> | null;
  state: DocumentState;
  applied: boolean;
  fileName: string;
  originalHref: string | null;
  values: Amounts;
  vacationLeft: string;
  rolLeft: string;
  /** What this payslip still asks a person to look at: 0 once applied, since applying is the decision. */
  warnings: number;
}

export interface RegisterGroup {
  year: number;
  rows: RegisterCells[];
  totals: Amounts;
  averages: Amounts;
  hasApplied: boolean;
}

function moneyCells(values: Record<string, string | null>, format: Format): Amounts {
  const cells = {} as Amounts;
  for (const field of SUMMED_FIELDS) cells[field] = moneyOf(values[field] ?? null, format);
  return cells;
}

const hoursCell = (value: string | null, format: Format) =>
  value === null ? NULL_DISPLAY : `${hoursOf(value, format)} h`;

function rowCells(row: RegisterRow, format: Format): RegisterCells {
  return {
    id: row.id,
    href: `/payroll/${row.id}`,
    month: row.period ? formatDate(row.period, "monthYear", format.locale) : String(row.year),
    badge: row.type === "ordinary" ? null : row.type,
    state: row.state,
    applied: row.applied,
    fileName: row.fileName,
    originalHref: row.hasOriginal ? `/payroll/${row.id}/original` : null,
    values: moneyCells(row.amounts, format),
    vacationLeft: hoursCell(row.leaveLeft.vacation, format),
    rolLeft: hoursCell(row.leaveLeft.rol, format),
    warnings: row.openWarnings,
  };
}

export function registerGroups(years: Register["years"], format: Format): RegisterGroup[] {
  return years.map((year) => ({
    year: year.year,
    rows: year.rows.map((row) => rowCells(row, format)),
    totals: moneyCells(year.totals, format),
    averages: moneyCells(year.averages, format),
    hasApplied: year.hasApplied,
  }));
}
