import type { Evidence } from "@/modules/imports/service";
import type { DocumentState } from "@/modules/imports/rules";
import type { Ctx } from "@/platform/context";
import { formatAmountInput, formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { type Cents, parseCents } from "@/platform/money";
import {
  effectiveValue,
  FIELD_GROUPS,
  FIELD_NAMES,
  FIELDS,
  type FieldGroup,
  type FieldName,
  isDerived,
} from "../fields";
import type { RegisterRow, YearSummary } from "../queries";
import { type PayslipType, SUMMED_FIELDS, type SummedField } from "../rules";

type Format = Pick<Ctx, "numberFormat" | "locale">;

export const STATE_TONE: Record<DocumentState, "pos" | "warn" | "neg" | "accent" | "neutral"> = {
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

/** A stored value as the person reads it: money, hours, a date, or the text itself. */
export function displayValue(field: FieldName, value: string | null, format: Format): string {
  if (value === null) return NULL_DISPLAY;
  const unit = FIELDS[field].unit;
  if (unit === "eur") return /^-?\d+(\.\d{1,2})?$/.test(value) ? formatMoney(parseCents(value), format.numberFormat) : value;
  if (unit === "hours") return /^-?\d+(\.\d{1,2})?$/.test(value) ? `${formatAmountInput(parseCents(value), format.numberFormat)} h` : value;
  if (unit === "date") return formatDate(value, "long", format.locale);
  return value;
}

/** A stored value as the person would type it into the correction field. */
export function inputValue(field: FieldName, value: string | null, format: Format): string {
  if (value === null) return "";
  const unit = FIELDS[field].unit;
  return unit === "eur" || unit === "hours" ? formatAmountInput(parseCents(value), format.numberFormat) : value;
}

export interface FieldView {
  field: FieldName;
  derived: boolean;
  value: string;
  input: string;
  original: string | null;
  origin: "printed" | "derived" | "inferred";
  verification: "unverified" | "confirmed" | "corrected";
  confidence: number;
  sourceLabel: string | null;
  derivedFrom: FieldName[];
  page: number | null;
  bbox: [number, number, number, number] | null;
  unit: string;
}

/** The review's fields by group, in the catalogue's order (spec §7.8). */
export function fieldGroups(evidence: readonly Evidence[], format: Format): { group: FieldGroup; fields: FieldView[] }[] {
  const byField = new Map(evidence.map((row) => [row.field, row]));
  return FIELD_GROUPS.map((group) => ({
    group,
    fields: FIELD_NAMES.filter((field) => FIELDS[field].group === group).flatMap((field): FieldView[] => {
      const row = byField.get(field);
      if (!row) return [];
      const current = effectiveValue(row);
      return [
        {
          field,
          derived: isDerived(field),
          value: displayValue(field, current, format),
          input: inputValue(field, current, format),
          original: row.verification === "corrected" ? displayValue(field, row.value, format) : null,
          origin: row.origin,
          verification: row.verification,
          confidence: Number(row.confidence),
          sourceLabel: row.sourceLabel,
          derivedFrom: (row.derivedFrom ?? []).filter((name): name is FieldName => Object.hasOwn(FIELDS, name)),
          page: row.page,
          bbox: row.bbox && row.bbox.length === 4 ? (row.bbox as [number, number, number, number]) : null,
          unit: FIELDS[field].unit,
        },
      ];
    }),
  })).filter((group) => group.fields.length > 0);
}

export interface RegisterCells {
  id: string;
  href: string;
  month: string;
  badge: PayslipType | null;
  state: DocumentState;
  applied: boolean;
  fileName: string;
  originalHref: string | null;
  values: Record<SummedField, string>;
  vacationLeft: string;
  rolLeft: string;
}

export interface RegisterGroup {
  year: number;
  rows: RegisterCells[];
  totals: Record<SummedField, string>;
  averages: Record<SummedField, string>;
  hasApplied: boolean;
}

function moneyCells(values: Record<SummedField, Cents | null>, format: Format): Record<SummedField, string> {
  return Object.fromEntries(
    Object.entries(values).map(([field, cents]) => [field, formatMoney(cents, format.numberFormat)]),
  ) as Record<SummedField, string>;
}

function hours(value: string | null | undefined, format: Format): string {
  return value === null || value === undefined ? NULL_DISPLAY : `${formatAmountInput(parseCents(value), format.numberFormat)} h`;
}

function rowCells(row: RegisterRow, format: Format): RegisterCells {
  const { payslip, document } = row;
  const values = {} as Record<SummedField, Cents | null>;
  for (const field of SUMMED_FIELDS) values[field] = payslip[field];
  return {
    id: document.id,
    href: `/payroll/${document.id}`,
    month: payslip.period ? formatDate(payslip.period, "monthYear", format.locale) : String(payslip.year),
    badge: payslip.type === "ordinary" ? null : payslip.type,
    state: document.state,
    applied: payslip.active,
    fileName: document.fileName,
    originalHref: document.storageKey ? `/payroll/${document.id}/original` : null,
    values: moneyCells(values, format),
    vacationLeft: hours(row.leaveLeft.vacation, format),
    rolLeft: hours(row.leaveLeft.rol, format),
  };
}

export function registerGroups(years: readonly YearSummary[], format: Format): RegisterGroup[] {
  return years.map((year) => ({
    year: year.year,
    rows: year.rows.map((row) => rowCells(row, format)),
    totals: moneyCells(year.totals, format),
    averages: moneyCells(year.averages, format),
    hasApplied: year.rows.some((row) => row.payslip.active),
  }));
}
