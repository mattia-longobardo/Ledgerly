// Funds · what the writes work on: the records, the error, and the inputs as a form hands them over.
import { z } from "zod";
import { isCivilDate } from "../../../shared/dates";
import { FEE_BASES, FEE_PERIODS, feeModes, needsPeriod } from "../../../shared/fees";
import { civilDate, optionalText } from "../../../shared/inputs";
import type { Cents } from "../../../shared/money";
import { fundContributionSources, fundFees, fundOperations, funds, fundValuations } from "../schema";
import { ACCRUAL_PERIODS, INTERVAL_UNITS, PAYROLL_COMPONENTS } from "../sources";

export type Fund = typeof funds.$inferSelect;
export type FundSource = typeof fundContributionSources.$inferSelect;
export type FundFee = typeof fundFees.$inferSelect;
export type FundOperation = typeof fundOperations.$inferSelect;
export type FundValuation = typeof fundValuations.$inferSelect;

type FundErrorCode =
  | "not_found"
  | "invalid"
  | "invalid_account"
  /** The account already values another fund: one fund per account. */
  | "account_taken"
  | "duplicate_name"
  | "archived"
  | "linked"
  | "future_date"
  | "movement_taken"
  /** A component of the payslip already goes to another fund; `detail` is that fund's name. */
  | "component_taken"
  /** The fund already has an active payslip source: one at a time. */
  | "payroll_active"
  /** A source with contributions is paused, never removed. */
  | "has_contributions"
  | "before_start";

export class FundError extends Error {
  constructor(
    readonly code: FundErrorCode,
    readonly detail: string | null = null,
  ) {
    super(code);
    this.name = "FundError";
  }
}

// ——— Inputs ——————————————————————————————————————————————————————————————————————————————————

const optionalDate = z
  .string()
  .nullable()
  .default(null)
  .transform((value) => (value === "" ? null : value))
  .refine((value) => value === null || isCivilDate(value), "Not a civil date");

export const fundInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: optionalText(80),
  compartment: optionalText(80),
  startOn: civilDate(),
  code: optionalText(40),
});
export type FundInput = z.input<typeof fundInputSchema>;

const payrollSourceSchema = z.object({
  kind: z.literal("payroll"),
  components: z
    .array(z.enum(PAYROLL_COMPONENTS))
    .min(1)
    .max(3)
    .refine((list) => new Set(list).size === list.length, "Twice the same component"),
  accrualPeriod: z.enum(ACCRUAL_PERIODS),
  employer: optionalText(120),
  /** The due date of each period's transfer; `null` for a source with no due dates. */
  due: z
    .object({ day: z.number().int().min(1).max(31), offsetMonths: z.number().int().min(0).max(3) })
    .nullable()
    .default(null),
  toleranceDays: z.number().int().min(0).max(120).default(15),
  note: optionalText(300),
  /** Keeps the explicit due dates a source already has; a rule in `due` replaces them. */
  keepDueEntries: z.boolean().default(false),
});

const bankDebitSourceSchema = z.object({
  kind: z.literal("bank_debit"),
  amountCents: z.bigint().positive(),
  frequency: z.object({ count: z.number().int().min(1).max(120), unit: z.enum(INTERVAL_UNITS) }),
  debitDay: z.number().int().min(1).max(31).nullable().default(null),
  accountId: z.uuid().nullable().default(null),
  payeeMatch: z.string().trim().min(1).max(80),
  validFrom: optionalDate,
  validTo: optionalDate,
});

const manualSourceSchema = z.object({ kind: z.literal("manual") });

export const sourceInputSchema = z.discriminatedUnion("kind", [
  payrollSourceSchema,
  bankDebitSourceSchema,
  manualSourceSchema,
]);
export type SourceInput = z.input<typeof sourceInputSchema>;
export type ParsedSource = z.output<typeof sourceInputSchema>;

export const feeInputSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    basis: z.enum(FEE_BASES),
    amountCents: z.bigint().positive().nullable().default(null),
    /** A fraction as text: "0.0045" is 0,45 %. */
    rate: z
      .string()
      .regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/)
      .nullable()
      .default(null),
    period: z.enum(FEE_PERIODS).nullable().default(null),
    sourceId: z.uuid().nullable().default(null),
    component: z.enum(PAYROLL_COMPONENTS).nullable().default(null),
    validFrom: optionalDate,
    validTo: optionalDate,
    note: optionalText(300),
  })
  .superRefine((fee, context) => {
    const mode = fee.amountCents !== null ? "amount" : "rate";
    const fail = (message: string) => context.addIssue({ code: "custom", message });
    if ((fee.amountCents === null) === (fee.rate === null)) fail("An amount or a rate, not both");
    else if (!feeModes(fee.basis).includes(mode)) fail("This basis does not take this value");
    if (fee.rate !== null && Number(fee.rate) <= 0) fail("A rate above zero");
    if (needsPeriod(fee.basis) !== (fee.period !== null)) fail("A period for this basis only");
    if (fee.validFrom !== null && fee.validTo !== null && fee.validTo < fee.validFrom) fail("Validity");
  });
export type FeeInput = z.input<typeof feeInputSchema>;
export type ParsedFee = z.output<typeof feeInputSchema>;

/** A new fund, as the four steps of the form hand it over: nothing is written before this. */
export interface NewFundInput {
  fund: FundInput;
  /** The currency of the account that holds the value; the display currency when left out. */
  currency?: string | null;
  /** Today's value, with its day; `null` for a fund with no value yet. */
  value?: { on: string; cents: Cents } | null;
  sources: SourceInput[];
  /** `sourceIndex` names a source of this same input, before it has an id. */
  fees: (Omit<FeeInput, "sourceId"> & { sourceIndex?: number | null })[];
}
