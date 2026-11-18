import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import { type Db, getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../platform/money";
import {
  fundContributionSources,
  fundOperations,
  funds,
  pensionCompetences,
  reconciliationLinks,
} from "../schema";
import { type Fund, FundError, requireFund } from "../service";
import type { PayrollComponent } from "../sources";
import { type Component, COMPONENTS, type CompetenceInput, DECISIONS, type Decision } from "./rules";

export type Competence = typeof pensionCompetences.$inferSelect;
type Executor = Db | Tx;

/**
 * The fund the payslips' competences are written to: the open fund with an active payslip source.
 * One row holds a whole payslip and a payslip has one row, so one fund at a time receives it
 * (`takenComponents` refuses a second); sending each component to its own fund comes with the
 * `PayslipApplied` event of release R2. `null` when no fund is fed by the payslip.
 */
export async function payrollFund(
  ctx: Pick<Ctx, "userId">,
  executor: Executor = getDb(),
): Promise<Fund | null> {
  const [row] = await executor
    .select({ fund: funds })
    .from(fundContributionSources)
    .innerJoin(funds, eq(funds.id, fundContributionSources.fundId))
    .where(
      and(
        userScoped(ctx).owns(fundContributionSources),
        eq(fundContributionSources.kind, "payroll"),
        eq(fundContributionSources.state, "active"),
        eq(funds.state, "active"),
      ),
    )
    .orderBy(asc(fundContributionSources.createdAt), asc(fundContributionSources.id))
    .limit(1);
  return row?.fund ?? null;
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
 * for a person with no fund fed by the payslip: the competences are published later, when a payslip
 * source is added (`replaceCompetences`). The same payslip again updates its one row.
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
 * when its payslip source is added and from Settings ("Rebuild"). The fund must be the one the
 * payslip feeds; the rows of any other fund are left alone, except those of the same payslips.
 */
export async function replaceCompetences(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  inputs: readonly CompetenceInput[],
): Promise<number> {
  await requireFund(ctx, fundId);
  if ((await payrollFund(ctx))?.id !== fundId) throw new FundError("invalid");
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

/**
 * A payslip's competence as one fund sees it: the components its source does not take are `null`,
 * as on a payslip that has no such line. The enrolment quota and the adjustment of a side go with
 * that side.
 */
export function competenceFor(competence: Competence, components: readonly PayrollComponent[]): Competence {
  const worker = components.includes("worker");
  const employer = components.includes("employer");
  return {
    ...competence,
    workerCents: worker ? competence.workerCents : null,
    workerEnrollmentCents: worker ? competence.workerEnrollmentCents : null,
    workerAdjustmentCents: worker ? competence.workerAdjustmentCents : null,
    employerCents: employer ? competence.employerCents : null,
    employerEnrollmentCents: employer ? competence.employerEnrollmentCents : null,
    employerAdjustmentCents: employer ? competence.employerAdjustmentCents : null,
    tfrCents: components.includes("tfr") ? competence.tfrCents : null,
  };
}

/**
 * The competences of each fund, oldest first (13th after December's ordinary payslip). One read for
 * all. Each fund then cuts them to the components its payslip source takes (`competenceFor`).
 */
export async function competencesOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  executor: Executor = getDb(),
): Promise<Map<string, Competence[]>> {
  const byFund = new Map<string, Competence[]>(fundIds.map((id) => [id, []]));
  if (fundIds.length === 0) return byFund;
  const rows = await executor
    .select()
    .from(pensionCompetences)
    .where(and(inArray(pensionCompetences.fundId, [...fundIds]), userScoped(ctx).owns(pensionCompetences)))
    .orderBy(
      asc(pensionCompetences.year),
      asc(pensionCompetences.quarter),
      sql`${pensionCompetences.payrollPeriod} asc nulls last`,
      asc(pensionCompetences.id),
    );
  for (const row of rows) byFund.get(row.fundId)?.push(row);
  return byFund;
}

// ——— The reviewer's word on a difference (spec §7.7; GC §11.9) ———

export type ReconciliationLink = typeof reconciliationLinks.$inferSelect;

export async function decisionsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  executor: Executor = getDb(),
): Promise<Map<string, ReconciliationLink[]>> {
  const byFund = new Map<string, ReconciliationLink[]>(fundIds.map((id) => [id, []]));
  if (fundIds.length === 0) return byFund;
  const rows = await executor
    .select()
    .from(reconciliationLinks)
    .where(and(inArray(reconciliationLinks.fundId, [...fundIds]), userScoped(ctx).owns(reconciliationLinks)))
    .orderBy(
      asc(reconciliationLinks.year),
      asc(reconciliationLinks.quarter),
      asc(reconciliationLinks.component),
    );
  for (const row of rows) byFund.get(row.fundId)?.push(row);
  return byFund;
}

interface DecisionInput {
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
 * The lines a decision is about come from the browser, and an array of ids has no foreign key: only the
 * lines of this fund of this user's can be named.
 */
async function requireOwnLines(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: Pick<DecisionInput, "competenceIds" | "operationIds">,
): Promise<void> {
  const ids = z.array(z.uuid());
  const competenceIds = [...new Set(ids.parse(input.competenceIds))];
  const operationIds = [...new Set(ids.parse(input.operationIds))];
  const [competences, operations] = await Promise.all([
    competenceIds.length === 0
      ? []
      : getDb()
          .select({ id: pensionCompetences.id })
          .from(pensionCompetences)
          .where(
            and(
              eq(pensionCompetences.fundId, fundId),
              inArray(pensionCompetences.id, competenceIds),
              userScoped(ctx).owns(pensionCompetences),
            ),
          ),
    operationIds.length === 0
      ? []
      : getDb()
          .select({ id: fundOperations.id })
          .from(fundOperations)
          .where(
            and(
              eq(fundOperations.fundId, fundId),
              inArray(fundOperations.id, operationIds),
              userScoped(ctx).owns(fundOperations),
            ),
          ),
  ]);
  if (competences.length !== competenceIds.length || operations.length !== operationIds.length) {
    throw new FundError("not_found");
  }
}

/**
 * A difference a person has looked at and accepted, with its note and what it was about (GC §11.9):
 * never a fee invented to make the books balance. The decision holds only while the difference is
 * the one decided on — a later contribution that changes it puts the period back in front of the
 * reviewer (`reconcile`).
 */
export async function decideDifference(
  ctx: Pick<Ctx, "userId">,
  fundId: string,
  input: DecisionInput,
  now: Date = new Date(),
): Promise<void> {
  await requireFund(ctx, fundId);
  await requireOwnLines(ctx, fundId, input);
  const note = input.note.trim();
  if (
    !Number.isInteger(input.quarter) ||
    input.quarter < 1 ||
    input.quarter > 12 ||
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
