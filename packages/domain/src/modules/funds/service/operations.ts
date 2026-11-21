// Funds · the operations a person writes in the register: contributions and the others.
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "../../../platform/db/errors";
import { userScoped } from "../../../platform/db/scope";
import { today } from "../../../shared/dates";
import { civilDate, optionalText } from "../../../shared/inputs";
import { isFutureDate } from "../../accounts";
import { getTransaction } from "../../transactions/queries";
import { fundOperations } from "../schema";
import { periodsPerYear } from "../sources";
import { type Fund, FundError, type FundOperation } from "./model";
import { requireOpenFund, sourcesOf } from "./reads";

// ——— Contributions and the other operations written by hand ————————————————————————————————————

const fee = z.bigint().nonnegative().nullable();
const periodOfSource = z
  .object({ year: z.number().int().min(1990).max(2200), index: z.number().int().min(1).max(12) })
  .nullable()
  .default(null);

/**
 * What a person writes in the register. A contribution is voluntary (one amount, which may be tied
 * to the movement that paid it) or from the payslip (the three components, as the fund states them,
 * for a period). The other operations are not contributions: joining, a transfer in from another
 * fund, a change of compartment, an exit. `feeCents: null` is a fee nobody knows yet.
 */
const contributionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("voluntary"),
    on: civilDate(),
    amountCents: z.bigint().positive(),
    feeCents: fee,
    transactionId: z.uuid().nullable().default(null),
    note: optionalText(200),
  }),
  z.object({
    kind: z.literal("payroll"),
    on: civilDate(),
    workerCents: z.bigint().nonnegative(),
    employerCents: z.bigint().nonnegative(),
    tfrCents: z.bigint().nonnegative(),
    /** The period the transfer is for, counted as the fund's payslip source counts it. */
    period: periodOfSource,
    feeCents: fee,
    note: optionalText(200),
  }),
  z.object({
    kind: z.literal("other"),
    classification: z.enum(["enrollment", "transfer_in", "switch", "withdrawal"]),
    on: civilDate(),
    amountCents: z.bigint().nonnegative(),
    /** Joining only: the period whose payslips accrued the enrolment quota, so the two reconcile. */
    period: periodOfSource,
    feeCents: fee,
    note: optionalText(200),
  }),
]);
export type ContributionInput = z.input<typeof contributionSchema>;

/** The columns of an operation, from what a person wrote. */
async function operationValues(ctx: Pick<Ctx, "userId" | "timeZone">, fund: Fund, input: ContributionInput) {
  const parsed = contributionSchema.parse(input);
  if (isFutureDate(parsed.on, today(ctx.timeZone))) throw new FundError("future_date");
  const feesCents = parsed.feeCents ?? 0n;
  const amounts = { workerCents: 0n, employerCents: 0n, tfrCents: 0n, otherCents: 0n };
  const base = {
    operationDate: parsed.on,
    feesCents,
    feesUnknown: parsed.feeCents === null,
    note: parsed.note,
    competenceYear: null as number | null,
    competenceQuarter: null as number | null,
    transactionId: null as string | null,
    sourceId: null as string | null,
  };
  /** The fund's payslip source, and a period it can count: a quarter, or a month. */
  const payrollSource = async (period: { index: number } | null) => {
    const payroll = (await sourcesOf(ctx, [fund.id])).filter((one) => one.kind === "payroll");
    const source = payroll.find((one) => one.state === "active") ?? payroll[0] ?? null;
    if (period !== null) {
      const limit = source?.accrualPeriod ? periodsPerYear(source.accrualPeriod) : 4;
      if (period.index > limit) throw new FundError("invalid");
    }
    return source;
  };
  if (parsed.kind === "voluntary") {
    if (feesCents > parsed.amountCents) throw new FundError("invalid");
    // The foreign key knows the movement exists, not whose it is: only the user's own can be tied.
    if (parsed.transactionId !== null && !(await getTransaction(ctx, parsed.transactionId))) {
      throw new FundError("not_found");
    }
    return {
      ...base,
      ...amounts,
      classification: "voluntary" as const,
      workerCents: parsed.amountCents,
      netCents: parsed.amountCents - feesCents,
      transactionId: parsed.transactionId,
    };
  }
  if (parsed.kind === "payroll") {
    const gross = parsed.workerCents + parsed.employerCents + parsed.tfrCents;
    if (gross <= 0n || feesCents > gross) throw new FundError("invalid");
    const source = await payrollSource(parsed.period);
    return {
      ...base,
      ...amounts,
      classification: "contribution" as const,
      workerCents: parsed.workerCents,
      employerCents: parsed.employerCents,
      tfrCents: parsed.tfrCents,
      netCents: gross - feesCents,
      competenceYear: parsed.period?.year ?? null,
      competenceQuarter: parsed.period?.index ?? null,
      sourceId: source?.id ?? null,
    };
  }
  const { classification, amountCents } = parsed;
  if (classification === "switch") {
    // A change of compartment moves no money across the fund's boundary: only its cost is written.
    if (amountCents !== 0n) throw new FundError("invalid");
    return { ...base, ...amounts, classification, netCents: -feesCents };
  }
  if (amountCents <= 0n) throw new FundError("invalid");
  if (classification === "withdrawal") {
    // What left the position, positive: the flows read it as money out, never as a loss.
    return { ...base, ...amounts, classification, otherCents: amountCents, netCents: -amountCents };
  }
  if (feesCents > amountCents) throw new FundError("invalid");
  const credited = {
    ...base,
    ...amounts,
    classification,
    otherCents: amountCents,
    netCents: amountCents - feesCents,
  };
  if (classification !== "enrollment" || parsed.period === null) return credited;
  // The enrolment quota of the payslips is credited in the period that accrued it.
  const source = await payrollSource(parsed.period);
  return {
    ...credited,
    competenceYear: parsed.period.year,
    competenceQuarter: parsed.period.index,
    sourceId: source?.id ?? null,
  };
}

const movementTaken = (error: unknown): never => {
  if (hasPgError(error, UNIQUE_VIOLATION, "fund_operations_transaction_uq")) {
    throw new FundError("movement_taken");
  }
  throw error;
};

/** A contribution, or another operation, written by hand in the fund's register. */
export async function addContribution(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  input: ContributionInput,
): Promise<FundOperation> {
  const fund = await requireOpenFund(ctx, fundId);
  const values = await operationValues(ctx, fund, input);
  const [row] = await getDb()
    .insert(fundOperations)
    .values(
      userScoped(ctx).stamp({
        fundId,
        originKey: `manual:${randomUUID()}`,
        originalType: values.classification,
        originalState: null,
        source: "manual" as const,
        ...values,
      }),
    )
    .returning()
    .catch(movementTaken);
  return row;
}

async function requireOperation(ctx: Pick<Ctx, "userId">, id: string): Promise<FundOperation> {
  const [row] = await getDb()
    .select()
    .from(fundOperations)
    .where(and(eq(fundOperations.id, id), userScoped(ctx).owns(fundOperations)));
  if (!row) throw new FundError("not_found");
  return row;
}

/**
 * An operation corrected by hand. One the job found among the movements keeps its movement and its
 * source: only its day, its amount, its fee and its note change — the fee is how an unknown one
 * becomes known. One read from a document before release N6 is not edited: it stays as it was read.
 */
export async function updateContribution(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  operationId: string,
  input: ContributionInput,
): Promise<FundOperation> {
  const current = await requireOperation(ctx, operationId);
  if (current.source === "import") throw new FundError("linked");
  const fund = await requireOpenFund(ctx, current.fundId);
  const values = await operationValues(ctx, fund, input);
  if (current.source === "rule") {
    if (values.classification !== "voluntary") throw new FundError("invalid");
    values.transactionId = current.transactionId;
    values.sourceId = current.sourceId;
  }
  const [row] = await getDb()
    .update(fundOperations)
    .set({
      ...values,
      originalType: current.source === "rule" ? current.originalType : values.classification,
    })
    .where(and(eq(fundOperations.id, operationId), userScoped(ctx).owns(fundOperations)))
    .returning()
    .catch(movementTaken);
  return row;
}

/**
 * An operation written by hand can go. One the job tied to a movement cannot: the job would bring it
 * straight back — the movement is hidden in Expenses instead, and hidden movements are never
 * matched. One read from a document before release N6 stays: it is the fund's history.
 */
export async function deleteContribution(ctx: Pick<Ctx, "userId">, operationId: string): Promise<void> {
  const current = await requireOperation(ctx, operationId);
  if (current.source === "import") throw new FundError("linked");
  if (current.source === "rule" && current.transactionId !== null) throw new FundError("linked");
  await getDb()
    .delete(fundOperations)
    .where(and(eq(fundOperations.id, operationId), userScoped(ctx).owns(fundOperations)));
}
