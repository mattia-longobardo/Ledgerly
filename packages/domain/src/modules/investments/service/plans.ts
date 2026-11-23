// The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3): a
// plan, its instalments and what the pages read of them. A plan writes purchases only (P1 B).
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../../accounts";
import { getTransaction } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import type { Cents } from "../../../shared/money";
import { civilDate } from "../../../shared/inputs";
import { PORTFOLIO_PROVIDER } from "../catalog";
import {
  dueDates,
  instalment,
  PLAN_FREQUENCIES,
  PLAN_MODES,
  PLAN_STATES,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
} from "../rules";
import {
  investmentAssets,
  investmentEvents,
  investmentOperations,
  investmentPlanRuns,
  investmentPlans,
} from "../schema";
import { assetOfInstrument } from "./assets";
import { lockInvestmentAccount, requireInvestmentAccount } from "./book";
import { optionalNote, positive } from "./events";
import { fromNumeric, InvestmentError, translated, type WriteCtx } from "./types";

export type InvestmentPlan = typeof investmentPlans.$inferSelect;
export type InvestmentPlanRun = typeof investmentPlanRuns.$inferSelect;

export const planInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    instrument: z.object({
      instrumentId: z.uuid(),
      mic: z
        .string()
        .regex(/^[A-Z0-9]{4}$/)
        .nullable(),
    }),
    amountCents: positive.nullable().default(null),
    quantity: positive.nullable().default(null),
    fractions: z.boolean().default(true),
    frequency: z.enum(PLAN_FREQUENCIES),
    interval: z.number().int().min(1).max(12).default(1),
    day: z.number().int().min(1).max(31),
    startOn: civilDate(),
    endOn: civilDate().nullable().default(null),
    runsLimit: z.number().int().min(1).max(600).nullable().default(null),
    debitAccountId: z.uuid().nullable().default(null),
    feeCents: z.bigint().nonnegative().nullable().default(null),
    feeRate: z.bigint().nonnegative().nullable().default(null),
    mode: z.enum(PLAN_MODES).default("propose"),
    note: optionalNote,
  })
  .refine((plan) => (plan.amountCents === null) !== (plan.quantity === null), "An amount or a quantity")
  .refine((plan) => plan.endOn === null || plan.runsLimit === null, "An end day or a number of instalments")
  .refine((plan) => plan.frequency !== "week" || plan.day <= 7, "A day of the week is 1-7")
  .refine((plan) => plan.feeCents === null || plan.feeRate === null, "A fee amount or a rate");
export type PlanInput = z.input<typeof planInputSchema>;

export const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  mode: z.enum(PLAN_MODES).optional(),
  state: z.enum(PLAN_STATES).optional(),
  endOn: civilDate().nullable().optional(),
  runsLimit: z.number().int().min(1).max(600).nullable().optional(),
  debitAccountId: z.uuid().nullable().optional(),
  feeCents: z.bigint().nonnegative().nullable().optional(),
  feeRate: z.bigint().nonnegative().nullable().optional(),
});
export type PlanUpdate = z.input<typeof planUpdateSchema>;

/** A plan lives in a manual portfolio only: a synced service has the provider's purchases (§11.3.3). */
async function requirePortfolio(ctx: Pick<Ctx, "userId">, accountId: string, transaction?: Tx) {
  const investment = await requireInvestmentAccount(ctx, accountId, transaction);
  if (investment.provider !== PORTFOLIO_PROVIDER) throw new InvestmentError("not_eligible");
  return investment;
}

/** The debit account is one of the person's own, or nothing. */
async function requireDebitAccount(ctx: Pick<Ctx, "userId">, accountId: string | null | undefined) {
  if (accountId !== null && accountId !== undefined && !(await getAccount(ctx, accountId))) {
    throw new InvestmentError("not_found");
  }
}

export async function createPlan(
  ctx: WriteCtx,
  accountId: string,
  input: PlanInput,
): Promise<{ id: string }> {
  const parsed = planInputSchema.parse(input);
  await requireDebitAccount(ctx, parsed.debitAccountId);
  return getDb().transaction(async (transaction) => {
    const investment = await requirePortfolio(ctx, accountId, transaction);
    await lockInvestmentAccount(ctx, accountId, transaction);
    const asset = await assetOfInstrument(ctx, parsed.instrument, transaction);
    const { instrument, note, ...plan } = parsed;
    void instrument;
    void note;
    const [row] = await transaction
      .insert(investmentPlans)
      .values(
        userScoped(ctx).stamp({
          ...plan,
          quantity: plan.quantity === null ? null : fromBigint(plan.quantity, QUANTITY_SCALE),
          feeRate: plan.feeRate === null ? null : fromBigint(plan.feeRate, RATE_SCALE),
          investmentAccountId: investment.id,
          assetId: asset.id,
          createdOn: today(ctx.timeZone),
        }),
      )
      .returning({ id: investmentPlans.id });
    return { id: row.id };
  });
}

const fromBigint = (value: bigint, scale: number) => {
  const text = value.toString().padStart(scale + 1, "0");
  return `${text.slice(0, -scale)}.${text.slice(-scale)}`;
};

/** The person's plan of that portfolio, or `not_found`. */
export async function requirePlan(
  ctx: Pick<Ctx, "userId">,
  accountId: string,
  planId: string,
  transaction?: Tx,
): Promise<InvestmentPlan> {
  const investment = await requirePortfolio(ctx, accountId, transaction);
  const [plan] = await (transaction ?? getDb())
    .select()
    .from(investmentPlans)
    .where(
      and(
        userScoped(ctx).owns(investmentPlans),
        eq(investmentPlans.id, planId),
        eq(investmentPlans.investmentAccountId, investment.id),
      ),
    );
  if (!plan) throw new InvestmentError("not_found");
  return plan;
}

export async function updatePlan(
  ctx: WriteCtx,
  accountId: string,
  planId: string,
  input: PlanUpdate,
): Promise<void> {
  const parsed = planUpdateSchema.parse(input);
  await requireDebitAccount(ctx, parsed.debitAccountId);
  const plan = await requirePlan(ctx, accountId, planId);
  const endOn = parsed.endOn === undefined ? plan.endOn : parsed.endOn;
  const runsLimit = parsed.runsLimit === undefined ? plan.runsLimit : parsed.runsLimit;
  if (endOn !== null && runsLimit !== null) throw new RangeError("An end day or a number of instalments");
  const { feeRate, ...rest } = parsed;
  await getDb()
    .update(investmentPlans)
    .set({
      ...rest,
      ...(feeRate === undefined
        ? {}
        : { feeRate: feeRate === null ? null : fromBigint(feeRate, RATE_SCALE) }),
      // A fee is an amount or a rate: setting one clears the other.
      ...(parsed.feeCents !== undefined && parsed.feeCents !== null ? { feeRate: null } : {}),
      ...(feeRate !== undefined && feeRate !== null ? { feeCents: null } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(investmentPlans.id, plan.id), userScoped(ctx).owns(investmentPlans)));
}

/** The schedule and the size of a plan, as the rules read them. */
export function scheduleOf(plan: InvestmentPlan) {
  return {
    frequency: plan.frequency,
    interval: plan.interval,
    day: plan.day,
    startOn: plan.startOn,
    endOn: plan.endOn,
    runsLimit: plan.runsLimit,
  };
}

export function sizeOf(plan: InvestmentPlan) {
  return {
    amountCents: plan.amountCents,
    quantity: fromNumeric(plan.quantity, QUANTITY_SCALE),
    fractions: plan.fractions,
    fee: { cents: plan.feeCents, rate: fromNumeric(plan.feeRate, RATE_SCALE) },
  };
}

/** A plan as the pages list it: its asset, its next due date and the instalments waiting. */
export interface PlanView {
  plan: InvestmentPlan;
  asset: { id: string; name: string; instrumentId: string | null; mic: string | null };
  nextDueOn: CivilDate | null;
  toConfirm: number;
  waitingPrice: number;
}

export async function listPlans(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
): Promise<PlanView[]> {
  const investment = await requirePortfolio(ctx, accountId);
  const rows = await getDb()
    .select({ plan: investmentPlans, asset: investmentAssets })
    .from(investmentPlans)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentPlans.assetId))
    .where(and(userScoped(ctx).owns(investmentPlans), eq(investmentPlans.investmentAccountId, investment.id)))
    .orderBy(investmentPlans.name, investmentPlans.id);
  const runs = await runsOf(
    ctx,
    rows.map((row) => row.plan.id),
  );
  const todayOn = today(ctx.timeZone);
  return rows.map(({ plan, asset }) => {
    const own = runs.filter((run) => run.planId === plan.id);
    const known = new Set(own.map((run) => run.dueOn));
    const next =
      plan.state === "active"
        ? (dueDates(scheduleOf(plan), addDays(todayOn, 400)).find(
            (day) => day >= todayOn && !known.has(day),
          ) ?? null)
        : null;
    return {
      plan,
      asset: { id: asset.id, name: asset.name, instrumentId: asset.instrumentId, mic: asset.mic },
      nextDueOn: next,
      toConfirm: own.filter((run) => run.state === "proposed").length,
      waitingPrice: own.filter((run) => run.state === "waiting_price").length,
    };
  });
}

async function runsOf(ctx: Pick<Ctx, "userId">, planIds: readonly string[]): Promise<InvestmentPlanRun[]> {
  if (planIds.length === 0) return [];
  return getDb()
    .select()
    .from(investmentPlanRuns)
    .where(and(userScoped(ctx).owns(investmentPlanRuns), inArray(investmentPlanRuns.planId, [...planIds])))
    .orderBy(desc(investmentPlanRuns.dueOn));
}

/** An instalment as the pages read it: the proposal at its price, its purchase and its bank movement. */
export interface RunView {
  run: InvestmentPlanRun;
  proposal: { on: CivilDate; quantity: bigint; unitPrice: bigint; spentCents: Cents; feeCents: Cents } | null;
  eventId: string | null;
  debit: { transactionId: string; on: CivilDate; cents: Cents; payee: string | null; linked: boolean } | null;
}

export async function listRuns(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  planId: string,
): Promise<RunView[]> {
  const plan = await requirePlan(ctx, accountId, planId);
  const runs = await runsOf(ctx, [plan.id]);
  const events = await eventsOfRuns(
    ctx,
    runs.map((run) => run.id),
  );
  return Promise.all(
    runs.map(async (run) => {
      const unitPrice = fromNumeric(run.price, PRICE_SCALE);
      const open = run.state === "proposed" || run.state === "waiting_price" || run.state === "pending";
      const proposal =
        open && unitPrice !== null
          ? { on: run.priceOn ?? run.dueOn, unitPrice, ...instalment(sizeOf(plan), unitPrice) }
          : null;
      return { run, proposal, eventId: events.get(run.id) ?? null, debit: await debitOf(ctx, run) };
    }),
  );
}

async function debitOf(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  run: InvestmentPlanRun,
): Promise<RunView["debit"]> {
  if (run.debitTransactionId === null) return null;
  const movement = await getTransaction(ctx, run.debitTransactionId);
  if (!movement) return null;
  return {
    transactionId: movement.id,
    on: civilDateIn(movement.occurredAt, ctx.timeZone),
    cents: -movement.amountCents,
    payee: movement.payee,
    linked: run.debitLinked,
  };
}

/** The purchase each instalment wrote, by instalment. */
async function eventsOfRuns(
  ctx: Pick<Ctx, "userId">,
  runIds: readonly string[],
): Promise<Map<string, string>> {
  if (runIds.length === 0) return new Map();
  const rows = await getDb()
    .select({ runId: investmentOperations.planRunId, eventId: investmentOperations.eventId })
    .from(investmentOperations)
    .where(
      and(userScoped(ctx).owns(investmentOperations), inArray(investmentOperations.planRunId, [...runIds])),
    );
  return new Map(rows.flatMap((row) => (row.runId === null ? [] : [[row.runId, row.eventId] as const])));
}

/** The plan and the instalment of each purchase a plan wrote, by event: the activity's «automatic» mark. */
export async function plansOfEvents(
  ctx: Pick<Ctx, "userId">,
  eventIds: readonly string[],
): Promise<Map<string, { planId: string; runId: string; name: string; automatic: boolean }>> {
  if (eventIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      eventId: investmentOperations.eventId,
      runId: investmentPlanRuns.id,
      planId: investmentPlans.id,
      name: investmentPlans.name,
      recordedBy: investmentPlanRuns.recordedBy,
    })
    .from(investmentOperations)
    .innerJoin(investmentPlanRuns, eq(investmentPlanRuns.id, investmentOperations.planRunId))
    .innerJoin(investmentPlans, eq(investmentPlans.id, investmentPlanRuns.planId))
    .where(
      and(userScoped(ctx).owns(investmentOperations), inArray(investmentOperations.eventId, [...eventIds])),
    );
  return new Map(
    rows.map((row) => [
      row.eventId,
      { planId: row.planId, runId: row.runId, name: row.name, automatic: row.recordedBy === "job" },
    ]),
  );
}

/**
 * Links a recorded instalment to the bank movement the matcher proposed (E7): the movement documents
 * the purchase. Only on the person's word; `not_editable` with nothing proposed, or linked already.
 */
export async function linkRunDebit(
  ctx: WriteCtx,
  accountId: string,
  planId: string,
  runId: string,
): Promise<void> {
  const plan = await requirePlan(ctx, accountId, planId);
  await getDb().transaction(async (transaction) => {
    const [run] = await transaction
      .select()
      .from(investmentPlanRuns)
      .where(
        and(
          userScoped(ctx).owns(investmentPlanRuns),
          eq(investmentPlanRuns.id, runId),
          eq(investmentPlanRuns.planId, plan.id),
        ),
      );
    if (!run) throw new InvestmentError("not_found");
    const eventId = (await eventsOfRuns(ctx, [run.id])).get(run.id);
    if (run.state !== "recorded" || run.debitTransactionId === null || run.debitLinked || !eventId) {
      throw new InvestmentError("not_editable");
    }
    await translated(
      transaction
        .update(investmentEvents)
        .set({ transactionId: run.debitTransactionId })
        .where(and(eq(investmentEvents.id, eventId), userScoped(ctx).owns(investmentEvents))),
    );
    await transaction
      .update(investmentPlanRuns)
      .set({ debitLinked: true, updatedAt: new Date() })
      .where(eq(investmentPlanRuns.id, run.id));
  });
}
