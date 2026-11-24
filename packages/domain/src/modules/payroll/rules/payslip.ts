// What a payslip is without a reader (rewrite plan R5g; 11-standardization.md §11.5): its kind, the
// employer's extra payments and pay frequency (E6), the base fields of the core and the fields of
// the country's pack as key-value pairs (E4), and a payslip typed by hand (ST-21).
import { z } from "zod";
import { COUNTRIES, countryRules, hasPack } from "../../../shared/country";
import { isCivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";

export const PAYSLIP_KINDS = ["ordinary", "extra", "bonus", "settlement"] as const;
export type PayslipKind = (typeof PAYSLIP_KINDS)[number];

/** Where a payslip came from: a document read with a profile, or typed by hand. */
export const PAYSLIP_SOURCES = ["read", "manual"] as const;

export const PAY_FREQUENCIES = ["monthly", "semimonthly", "biweekly", "weekly"] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];

// shortcut: the old `payslips.type` names three extra payments only, and it stays written until
// R5f; lift the cap when R5f drops the old type.
export const MAX_EXTRA_PAYMENTS = 3;

/** An employer's configuration: how often it pays, and the month of each extra payment (1st, 2nd…). */
export interface Employer {
  payFrequency: PayFrequency;
  extraMonths: number[];
}

/**
 * Without a configuration: monthly pay and one extra payment in December — what the register
 * assumed before the employer was configurable, so a person's KPIs do not move.
 */
export const DEFAULT_EMPLOYER: Readonly<Employer> = { payFrequency: "monthly", extraMonths: [12] };

export const employerInputSchema = z
  .object({
    payFrequency: z.enum(PAY_FREQUENCIES),
    extraMonths: z.array(z.number().int().min(1).max(12)).max(MAX_EXTRA_PAYMENTS),
  })
  .strict();

type FieldGroup = "compensation" | "taxes" | "contributions" | "tfr" | "net";

export interface CatalogueField {
  key: string;
  group: FieldGroup;
  /** A column of the core: every payslip has it, whatever the country. */
  base: boolean;
  /** A column of the register: summed per year, averaged per ordinary month. */
  summed: boolean;
}

/** The base fields: the columns of the core that the register and the KPIs read. */
export const BASE_FIELDS = [
  { key: "gross", group: "compensation", base: true, summed: true },
  { key: "taxesTotal", group: "taxes", base: true, summed: true },
  { key: "employeeSocial", group: "contributions", base: true, summed: true },
  { key: "netPay", group: "net", base: true, summed: true },
] as const satisfies readonly CatalogueField[];
export type BaseField = (typeof BASE_FIELDS)[number]["key"];

/** Every field a pack registers: what a stored pair may be, whatever the person's country now. */
export const COUNTRY_FIELDS: readonly CatalogueField[] = [
  ...new Map(
    COUNTRIES.flatMap((country) => countryRules(country).payslipFields).map((field) => [
      field.key,
      { ...field, base: false },
    ]),
  ).values(),
];

export function isCountryField(key: string): boolean {
  return COUNTRY_FIELDS.some((field) => field.key === key);
}

/** The catalogue a person's payslips offer: the base fields, then their country's. */
export function fieldCatalogue(country: string | null): CatalogueField[] {
  const pack = hasPack(country) ? countryRules(country).payslipFields : [];
  return [...BASE_FIELDS, ...pack.map((field) => ({ ...field, base: false }))];
}

/** The register's summed columns, from the catalogue: the base ones, then every pack's. */
export const REGISTER_FIELDS: readonly string[] = [...BASE_FIELDS, ...COUNTRY_FIELDS]
  .filter((field) => field.summed)
  .map((field) => field.key);

const cents = () => z.bigint();

/**
 * A payslip typed by hand (ST-21): its kind and month — or the number of its extra payment —, the
 * four base amounts in cents, optional fields of the catalogue and an optional document.
 */
export const manualPayslipSchema = z
  .object({
    kind: z.enum(PAYSLIP_KINDS),
    year: z.number().int().min(1990).max(2200),
    month: z.number().int().min(1).max(12).nullable(),
    extraNumber: z.number().int().min(1).max(MAX_EXTRA_PAYMENTS).nullable(),
    paidOn: z.string().refine(isCivilDate).nullable(),
    gross: cents().min(0n),
    taxes: cents().min(0n),
    contributions: cents().min(0n),
    net: cents(),
    fields: z.record(z.string().refine(isCountryField), cents()),
    documentId: z.uuid().nullable(),
  })
  .strict()
  .refine((input) => input.net <= input.gross, { path: ["net"] })
  // An ordinary payslip has its month; an extra payment has its number and no month.
  .refine((input) => input.kind !== "ordinary" || input.month !== null, { path: ["month"] })
  .refine((input) => (input.kind === "extra") === (input.extraNumber !== null), { path: ["extraNumber"] })
  .refine((input) => input.kind !== "extra" || input.month === null, { path: ["month"] });
export type ManualPayslip = z.output<typeof manualPayslipSchema>;

/** The first of the month a manual payslip pays, or null. */
export function periodOfManual(input: Pick<ManualPayslip, "year" | "month">): string | null {
  return input.month === null ? null : `${input.year}-${String(input.month).padStart(2, "0")}-01`;
}

/** The amounts of a manual payslip as the payslip's base columns. */
export function baseColumnsOf(input: ManualPayslip): Record<BaseField, Cents> {
  return { gross: input.gross, taxesTotal: input.taxes, employeeSocial: input.contributions, netPay: input.net };
}
