import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { createAccount, removeAccount } from "@/modules/accounts/service";
import type { Ctx } from "@/platform/context";
import { isCivilDate } from "@/platform/dates";
import { type Db, getDb, type Tx } from "@/platform/db/client";
import { hasPgError, UNIQUE_VIOLATION } from "@/platform/db/errors";
import { userScoped } from "@/platform/db/scope";
import { randomUUID } from "node:crypto";
import {
  fundFeeTariffs,
  fundOperations,
  funds,
  pensionCompetences,
  pensionRules,
  reconciliationLinks,
} from "../schema";
import { duplicateName, type Fund, FundError, requireFund } from "../service";
import type { Cents } from "@/platform/money";
import {
  COMETA_SCHEDULE,
  COMETA_SOURCES,
  COMETA_TARIFF,
  type Component,
  COMPONENTS,
  type CompetenceInput,
  DECISIONS,
  type Decision,
  DEFAULT_TOLERANCE_DAYS,
  isQuarter,
} from "./rules";

export type PensionRule = typeof pensionRules.$inferSelect;
export type Competence = typeof pensionCompetences.$inferSelect;
type Executor = Db | Tx;

/** A pension fund of this user's, or `not_found` — a PAC is not one. */
export async function requirePensionFund(ctx: Pick<Ctx, "userId">, id: string): Promise<Fund> {
  const fund = await requireFund(ctx, id);
  if (fund.type !== "pension") throw new FundError("not_found");
  return fund;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

export const pensionFundSchema = z.object({
  name: z.string().trim().min(1).max(80),
  provider: optionalText(80),
  compartment: optionalText(80),
  startOn: z.string().refine(isCivilDate, "Not a civil date"),
  /** The payslips' competences go to this fund; the first pension fund takes them by default. */
  receivesPayroll: z.boolean().nullable().default(null),
});
export type PensionFundInput = z.input<typeof pensionFundSchema>;

/**
 * The public tariff (GC §6.1), seeded once for the whole server: it is nobody's data. Re-seeding is
 * a no-op on the `(provider, item, valid_from)` key.
 */
export async function seedTariffs(executor: Executor = getDb()): Promise<void> {
  await executor
    .insert(fundFeeTariffs)
    .values(
      COMETA_TARIFF.items.map((item) => ({
        provider: COMETA_TARIFF.provider,
        validFrom: COMETA_TARIFF.validFrom,
        item: item.item,
        amountCents: item.amountCents,
        rate: item.rate,
        unit: item.unit,
        note: item.note,
        sourceUrl: COMETA_SOURCES.costs,
      })),
    )
    .onConflictDoNothing();
}

/** The tariff rows of a provider, newest version first. */
export async function feeTariffs(provider = COMETA_TARIFF.provider) {
  await seedTariffs();
  return getDb()
    .select()
    .from(fundFeeTariffs)
    .where(eq(fundFeeTariffs.provider, provider))
    .orderBy(desc(fundFeeTariffs.validFrom), asc(fundFeeTariffs.item));
}

/**
 * A new pension fund (spec §7.7, plan F6 §3.3): its value lives on a new `pension` account — in net
 * worth, never cash (F1) —, the Cometa payment schedule is seeded with its source and tolerance, and
 * it takes the payslips' competences if asked to or if it is this person's first pension fund. The
 * competences of payslips applied before it existed are published by the caller
 * (`replaceCompetences`), which reads them from payroll.
 */
export async function createPensionFund(ctx: Ctx, input: PensionFundInput): Promise<Fund> {
  const parsed = pensionFundSchema.parse(input);
  const account = await createAccount(ctx, {
    name: parsed.name,
    type: "pension",
    currency: "EUR",
    color: null,
    reference: "",
    purpose: "",
    openedOn: parsed.startOn,
    notes: "",
    openingBalance: null,
  });
  try {
    return await getDb().transaction(async (tx) => {
      const [current] = await tx
        .select({ id: funds.id })
        .from(funds)
        .where(and(userScoped(ctx).owns(funds), eq(funds.receivesPayroll, true)));
      const receivesPayroll = parsed.receivesPayroll ?? current === undefined;
      if (receivesPayroll && current) {
        await tx
          .update(funds)
          .set({ receivesPayroll: false })
          .where(and(eq(funds.id, current.id), userScoped(ctx).owns(funds)));
      }
      const [fund] = await duplicateName(
        tx
          .insert(funds)
          .values(
            userScoped(ctx).stamp({
              name: parsed.name,
              type: "pension" as const,
              provider: parsed.provider,
              compartment: parsed.compartment,
              startOn: parsed.startOn,
              valuationAccountId: account.id,
              receivesPayroll,
            }),
          )
          .returning(),
      );
      await tx.insert(pensionRules).values(
        userScoped(ctx).stamp({
          fundId: fund.id,
          kind: "payment_schedule" as const,
          validFrom: parsed.startOn,
          schedule: [...COMETA_SCHEDULE],
          toleranceDays: DEFAULT_TOLERANCE_DAYS,
          source: COMETA_SOURCES.schedule,
          verifiedOn: COMETA_SOURCES.verifiedOn,
        }),
      );
      await seedTariffs(tx);
      return fund;
    });
  } catch (error) {
    // The account made for it would otherwise be left behind with no fund.
    await removeAccount(ctx, account.id);
    throw error;
  }
}

/** Makes this pension fund the one the payslips' competences go to (plan F6 §3.6.2). */
export async function setReceivesPayroll(ctx: Pick<Ctx, "userId">, fundId: string): Promise<void> {
  await requirePensionFund(ctx, fundId);
  await getDb().transaction(async (tx) => {
    await tx
      .update(funds)
      .set({ receivesPayroll: false })
      .where(and(userScoped(ctx).owns(funds), eq(funds.receivesPayroll, true)));
    await tx
      .update(funds)
      .set({ receivesPayroll: true })
      .where(and(eq(funds.id, fundId), userScoped(ctx).owns(funds)));
  });
}

/** The fund the payslips' competences go to: this person's `receives_payroll` pension fund, if any. */
export async function payrollFund(
  ctx: Pick<Ctx, "userId">,
  executor: Executor = getDb(),
): Promise<Fund | null> {
  const [row] = await executor
    .select()
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.receivesPayroll, true), eq(funds.type, "pension")));
  return row ?? null;
}

// ——— Rules (spec §6; GC §3.2, §4) ———

export async function pensionRulesOf(ctx: Pick<Ctx, "userId">, fundId: string, executor: Executor = getDb()) {
  return executor
    .select()
    .from(pensionRules)
    .where(and(eq(pensionRules.fundId, fundId), userScoped(ctx).owns(pensionRules)))
    .orderBy(asc(pensionRules.kind), desc(pensionRules.validFrom), asc(pensionRules.id));
}

/** The display tolerance of the schedule in force (design: 15 days), distinct from the due date. */
export async function saveTolerance(ctx: Pick<Ctx, "userId">, fundId: string, days: number): Promise<void> {
  await requirePensionFund(ctx, fundId);
  if (!Number.isInteger(days) || days < 0 || days > 120) throw new FundError("invalid");
  await getDb()
    .update(pensionRules)
    .set({ toleranceDays: days })
    .where(
      and(
        eq(pensionRules.fundId, fundId),
        eq(pensionRules.kind, "payment_schedule"),
        userScoped(ctx).owns(pensionRules),
      ),
    );
}

const percent = z
  .string()
  .trim()
  .transform((value) => (value === "" ? null : value.replace(",", ".")))
  .nullable()
  .refine(
    (value) => value === null || (/^\d{1,3}(\.\d{1,4})?$/.test(value) && Number(value) <= 100),
    "Not a percent",
  )
  .default(null);

export const contributionRuleSchema = z.object({
  validFrom: z.string().refine(isCivilDate, "Not a civil date"),
  validTo: z
    .string()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || isCivilDate(value), "Not a civil date")
    .default(null),
  ccnl: optionalText(120),
  base: optionalText(200),
  workerPct: percent,
  employerPct: percent,
  tfrPct: percent,
  source: optionalText(300),
  verifiedOn: z
    .string()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .refine((value) => value === null || isCivilDate(value), "Not a civil date")
    .default(null),
});
export type ContributionRuleInput = z.input<typeof contributionRuleSchema>;

/**
 * A contribution rule with its validity (GC §3.2): recorded and shown — CCNL, base, percentages,
 * source, verified on —, never used to rewrite what a payslip documents (plan F6 §3.6.6).
 */
export async function addContributionRule(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: ContributionRuleInput,
): Promise<PensionRule> {
  await requirePensionFund(ctx, fundId);
  const parsed = contributionRuleSchema.parse(input);
  if (parsed.validTo !== null && parsed.validTo < parsed.validFrom) throw new FundError("invalid");
  const [row] = await getDb()
    .insert(pensionRules)
    .values(userScoped(ctx).stamp({ fundId, kind: "contribution" as const, ...parsed }))
    .returning();
  return row;
}

export async function deleteContributionRule(ctx: Pick<Ctx, "userId">, ruleId: string): Promise<void> {
  await getDb()
    .delete(pensionRules)
    .where(
      and(
        eq(pensionRules.id, ruleId),
        eq(pensionRules.kind, "contribution"),
        userScoped(ctx).owns(pensionRules),
      ),
    );
}

// ——— Competences: the payroll sink (spec §7.8 "Applicazione"; plan F6 §3.1, §3.4.2) ———

function competenceValues(input: CompetenceInput) {
  return {
    payrollPeriod: input.payrollPeriod,
    payslipType: input.payslipType,
    year: input.year,
    quarter: input.quarter,
    workerCents: input.workerCents,
    employerCents: input.employerCents,
    tfrCents: input.tfrCents,
    workerEnrollmentCents: input.workerEnrollmentCents,
    employerEnrollmentCents: input.employerEnrollmentCents,
    workerAdjustmentCents: input.workerAdjustmentCents,
    employerAdjustmentCents: input.employerAdjustmentCents,
    sourceLineIds: input.sourceLineIds,
  };
}

/**
 * What an applied payslip accrued, written inside payroll's applying transaction. Nothing happens
 * for a person without a pension fund taking payroll: the competences are published later, when
 * one is created (`replaceCompetences`). The same payslip again updates its one row.
 */
export async function recordCompetence(
  ctx: Pick<Ctx, "userId">,
  input: CompetenceInput,
  tx: Tx,
): Promise<void> {
  const fund = await payrollFund(ctx, tx);
  if (!fund) return;
  const values = competenceValues(input);
  await tx
    .insert(pensionCompetences)
    .values(userScoped(ctx).stamp({ fundId: fund.id, payslipId: input.payslipId, ...values }))
    .onConflictDoUpdate({ target: pensionCompetences.payslipId, set: { fundId: fund.id, ...values } });
}

/** A superseded payslip takes its competence with it (plan F6 §3.4.2). */
export async function dropCompetence(ctx: Pick<Ctx, "userId">, payslipId: string, tx: Tx): Promise<void> {
  await tx
    .delete(pensionCompetences)
    .where(and(eq(pensionCompetences.payslipId, payslipId), userScoped(ctx).owns(pensionCompetences)));
}

/**
 * Publishes the competences of every applied payslip to this fund from scratch (plan F6 §3.4.2):
 * at the fund's creation and from its Settings ("Rebuild"). The fund must be the one taking
 * payroll; the rows of any other fund are left alone.
 */
export async function replaceCompetences(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  inputs: readonly CompetenceInput[],
): Promise<number> {
  const fund = await requirePensionFund(ctx, fundId);
  if (!fund.receivesPayroll) throw new FundError("invalid");
  return getDb().transaction(async (tx) => {
    await tx
      .delete(pensionCompetences)
      .where(and(userScoped(ctx).owns(pensionCompetences), eq(pensionCompetences.fundId, fundId)));
    // A payslip's competence belongs to one fund: one that another fund held moves here.
    const ids = inputs.map((input) => input.payslipId);
    if (ids.length > 0) {
      await tx
        .delete(pensionCompetences)
        .where(
          and(
            userScoped(ctx).owns(pensionCompetences),
            sql`${pensionCompetences.payslipId} = any(${sql.param(ids)}::uuid[])`,
          ),
        );
      await tx
        .insert(pensionCompetences)
        .values(
          inputs.map((input) =>
            userScoped(ctx).stamp({ fundId, payslipId: input.payslipId, ...competenceValues(input) }),
          ),
        );
    }
    return inputs.length;
  });
}

/** The competences of a fund, oldest first (13th after December's ordinary payslip). */
export async function competencesOf(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  executor: Executor = getDb(),
): Promise<Competence[]> {
  return executor
    .select()
    .from(pensionCompetences)
    .where(and(eq(pensionCompetences.fundId, fundId), userScoped(ctx).owns(pensionCompetences)))
    .orderBy(
      asc(pensionCompetences.year),
      asc(pensionCompetences.quarter),
      sql`${pensionCompetences.payrollPeriod} asc nulls last`,
      asc(pensionCompetences.id),
    );
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return hasPgError(error, UNIQUE_VIOLATION, constraint);
}

// ——— The reviewer's word on a difference (spec §7.7; GC §11.9) ———

export type ReconciliationLink = typeof reconciliationLinks.$inferSelect;

export async function decisionsOf(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  executor: Executor = getDb(),
): Promise<ReconciliationLink[]> {
  return executor
    .select()
    .from(reconciliationLinks)
    .where(and(eq(reconciliationLinks.fundId, fundId), userScoped(ctx).owns(reconciliationLinks)))
    .orderBy(
      asc(reconciliationLinks.year),
      asc(reconciliationLinks.quarter),
      asc(reconciliationLinks.component),
    );
}

export interface DecisionInput {
  year: number;
  quarter: number;
  component: Component;
  decision: Decision;
  note: string;
  differenceCents: Cents;
  accruedCents: Cents | null;
  creditedCents: Cents | null;
  competenceIds: string[];
  operationIds: string[];
}

/**
 * A difference a person has looked at and accepted, with its note and what it was about (GC §11.9):
 * never a fee invented to make the books balance. The decision holds only while the difference is
 * the one decided on — a later import that changes it puts the quarter back in front of the
 * reviewer (`reconcile`).
 */
export async function decideDifference(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: DecisionInput,
  now: Date = new Date(),
): Promise<void> {
  await requirePensionFund(ctx, fundId);
  const note = input.note.trim();
  if (
    !isQuarter(input.quarter) ||
    !COMPONENTS.includes(input.component) ||
    !DECISIONS.includes(input.decision) ||
    note.length < 1 ||
    note.length > 500
  ) {
    throw new FundError("invalid");
  }
  const values = {
    decision: input.decision,
    note,
    differenceCents: input.differenceCents,
    accruedCents: input.accruedCents,
    creditedCents: input.creditedCents,
    competenceIds: input.competenceIds,
    operationIds: input.operationIds,
    decidedBy: ctx.userId,
    decidedAt: now,
  };
  await getDb()
    .insert(reconciliationLinks)
    .values(
      userScoped(ctx).stamp({
        fundId,
        year: input.year,
        quarter: input.quarter,
        component: input.component,
        ...values,
      }),
    )
    .onConflictDoUpdate({
      target: [
        reconciliationLinks.fundId,
        reconciliationLinks.year,
        reconciliationLinks.quarter,
        reconciliationLinks.component,
      ],
      set: values,
    });
}

/** The reviewer takes their word back: the difference is open again. */
export async function clearDecision(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  year: number,
  quarter: number,
  component: Component,
): Promise<void> {
  await getDb()
    .delete(reconciliationLinks)
    .where(
      and(
        eq(reconciliationLinks.fundId, fundId),
        eq(reconciliationLinks.year, year),
        eq(reconciliationLinks.quarter, quarter),
        eq(reconciliationLinks.component, component),
        userScoped(ctx).owns(reconciliationLinks),
      ),
    );
}

// ——— Voluntary contributions (design "Add a voluntary contribution"; GC §3.1) ———

export const voluntarySchema = z.object({
  on: z.string().refine(isCivilDate, "Not a civil date"),
  amountCents: z.bigint().positive(),
  feesCents: z.bigint().nonnegative().default(0n),
  note: optionalText(200),
  transactionId: z.uuid().nullable().default(null),
});
export type VoluntaryInput = z.input<typeof voluntarySchema>;

/**
 * A payment made straight to the fund, outside payroll (GC §3.1): its own operation, which raises
 * what was paid in and never the gain, and which can be tied to the movement that paid it, as a
 * PAC deposit is. It has no competence quarter: it reconciles against no payslip.
 */
export async function addVoluntaryContribution(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: VoluntaryInput,
): Promise<typeof fundOperations.$inferSelect> {
  await requirePensionFund(ctx, fundId);
  const parsed = voluntarySchema.parse(input);
  if (parsed.feesCents > parsed.amountCents) throw new FundError("invalid");
  const [row] = await getDb()
    .insert(fundOperations)
    .values(
      userScoped(ctx).stamp({
        fundId,
        originKey: `manual:${randomUUID()}`,
        originalType: "Versamento volontario",
        classification: "voluntary" as const,
        originalState: null,
        operationDate: parsed.on,
        workerCents: parsed.amountCents,
        feesCents: parsed.feesCents,
        netCents: parsed.amountCents - parsed.feesCents,
        transactionId: parsed.transactionId,
        source: "manual" as const,
        note: parsed.note,
      }),
    )
    .returning();
  return row;
}

/** A manual operation can be removed; one that came from a document cannot (the export owns it). */
export async function deleteManualOperation(ctx: Pick<Ctx, "userId">, operationId: string): Promise<void> {
  const deleted = await getDb()
    .delete(fundOperations)
    .where(
      and(
        eq(fundOperations.id, operationId),
        eq(fundOperations.source, "manual"),
        userScoped(ctx).owns(fundOperations),
      ),
    )
    .returning({ id: fundOperations.id });
  if (deleted.length === 0) throw new FundError("linked");
}
