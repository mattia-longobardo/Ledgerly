// The bodies of the funds' writes (rewrite plan R2, 05-refactor.md §5.5 «funds»): what a form sends,
// in canonical form. Amounts are decimal strings ("1234.56"), a fee's rate a percentage ("0.45").
import { z } from "zod";
import { civilDate, id } from "../primitives";
import { ACCRUAL_PERIODS, FEE_BASES, FEE_PERIODS, INTERVAL_UNITS, PAYROLL_COMPONENTS } from "./shared";

const amount = () => z.string().regex(/^\d+(\.\d{1,2})?$/);
const percentRate = () => z.string().regex(/^\d{1,3}(\.\d{1,4})?$/);
const optionalText = (max: number) => z.string().max(max).nullable().default(null);

export const fundBody = z
  .object({
    name: z.string().min(1).max(80),
    provider: optionalText(80),
    compartment: optionalText(80),
    startOn: civilDate(),
    code: optionalText(40),
  })
  .strict();

export const sourceBody = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("payroll"),
      components: z.array(z.enum(PAYROLL_COMPONENTS)).min(1).max(3),
      accrualPeriod: z.enum(ACCRUAL_PERIODS),
      employer: optionalText(120),
      due: z.object({ day: z.number().int(), offsetMonths: z.number().int() }).nullable().default(null),
      toleranceDays: z.number().int().default(15),
      note: optionalText(300),
      keepDueEntries: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("bank_debit"),
      amount: amount(),
      frequency: z.object({ count: z.number().int(), unit: z.enum(INTERVAL_UNITS) }),
      debitDay: z.number().int().nullable().default(null),
      accountId: id().nullable().default(null),
      payeeMatch: z.string().min(1).max(80),
      validFrom: civilDate().nullable().default(null),
      validTo: civilDate().nullable().default(null),
    })
    .strict(),
  z.object({ kind: z.literal("manual") }).strict(),
]);

export const feeBody = z
  .object({
    label: z.string().min(1).max(80),
    basis: z.enum(FEE_BASES),
    /** An amount or a rate, as the basis takes it (`invalid` otherwise). */
    amount: amount().nullable().default(null),
    rate: percentRate().nullable().default(null),
    period: z.enum(FEE_PERIODS).nullable().default(null),
    sourceId: id().nullable().default(null),
    component: z.enum(PAYROLL_COMPONENTS).nullable().default(null),
    validFrom: civilDate().nullable().default(null),
    validTo: civilDate().nullable().default(null),
    note: optionalText(300),
  })
  .strict();

const competence = z.object({ year: z.number().int(), index: z.number().int() }).nullable().default(null);
const operationFee = amount().nullable();

/** What a person writes in the register: a voluntary payment, a payslip transfer, another operation. */
export const operationBody = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("voluntary"),
      on: civilDate(),
      amount: amount(),
      fee: operationFee,
      transactionId: id().nullable().default(null),
      note: optionalText(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("payroll"),
      on: civilDate(),
      worker: amount(),
      employer: amount(),
      tfr: amount(),
      competence,
      fee: operationFee,
      note: optionalText(200),
    })
    .strict(),
  z
    .object({
      kind: z.literal("other"),
      classification: z.enum(["enrollment", "transfer_in", "switch", "withdrawal"]),
      on: civilDate(),
      amount: amount(),
      competence,
      fee: operationFee,
      note: optionalText(200),
    })
    .strict(),
]);

export const valuationBody = z
  .object({ on: civilDate(), value: amount(), note: z.string().max(200).nullable().default(null) })
  .strict();
