// The purchase plans of a manual portfolio (rewrite plan R5d, step 2; 11-standardization.md §11.3): a
// plan, its instalments, and the purchases plans wrote. A plan writes purchases only (P1 B).
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { civilDate } from "../../../shared/inputs";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { PLAN_FREQUENCIES, PLAN_MODES, PLAN_STATES, QUANTITY_SCALE, RATE_SCALE } from "../rules";
import {
  investmentEvents,
  investmentOperations,
  investmentPlanRunLines,
  investmentPlanRuns,
  investmentPlans,
} from "../schema";
import { assetOfInstrument, requireAsset } from "./assets";
import { BASKET_FREQUENCIES, instrumentsSchema, writeInstruments } from "./plan-instruments";
import { lockInvestmentAccount, requireInvestmentAccount } from "./book";
import { optionalNote, positive } from "./events";
import { fromNumeric, InvestmentError, translated, type WriteCtx } from "./types";

export type InvestmentPlan = typeof investmentPlans.$inferSelect;
export type InvestmentPlanRun = typeof investmentPlanRuns.$inferSelect;

const planInputSchema = z
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

const basketSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    amountCents: positive,
    instruments: instrumentsSchema,
    frequency: z.enum(BASKET_FREQUENCIES),
    interval: z.number().int().min(1).max(12).default(1),
    day: z.number().int().min(1).max(31).default(1),
    startOn: civilDate(),
    endOn: civilDate().nullable().default(null),
    runsLimit: z.number().int().min(1).max(600).nullable().default(null),
    debitAccountId: z.uuid().nullable().default(null),
    feeCents: z.bigint().nonnegative().nullable().default(null),
    feeRate: z.bigint().nonnegative().nullable().default(null),
  })
  .refine((plan) => plan.endOn === null || plan.runsLimit === null, "An end day or a number of executions")
  .refine((plan) => plan.frequency !== "week" || plan.day <= 7, "A day of the week is 1-7")
  .refine((plan) => plan.feeCents === null || plan.feeRate === null, "A fee amount or a rate");
type BasketInput = z.input<typeof basketSchema>;

const planUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  // A basket only (PERS-681): its amount, its instruments and its cadence, from the next execution.
  amountCents: positive.optional(),
  instruments: instrumentsSchema.optional(),
  frequency: z.enum(BASKET_FREQUENCIES).optional(),
  interval: z.number().int().min(1).max(12).optional(),
  day: z.number().int().min(1).max(31).optional(),
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

/**
 * A basket plan (PERS-681 §3.1): 1-10 instruments by weight, an amount of each execution in the
 * portfolio's currency, whole shares, proposals only (M3). It starts today or later: no execution
 * in the past for a new plan.
 */
export async function createBasketPlan(
  ctx: WriteCtx,
  accountId: string,
  input: BasketInput,
): Promise<{ id: string }> {
  const parsed = basketSchema.parse(input);
  const todayOn = today(ctx.timeZone);
  if (parsed.startOn < todayOn) throw new RangeError("A plan starts today or later");
  await requireDebitAccount(ctx, parsed.debitAccountId);
  return getDb().transaction(async (transaction) => {
    const investment = await requirePortfolio(ctx, accountId, transaction);
    await lockInvestmentAccount(ctx, accountId, transaction);
    const { instruments, feeRate, amountCents, ...schedule } = parsed;
    // The R5d columns hold the heaviest instrument and the amount: the image before reads every row.
    const first = await heaviestAsset(ctx, transaction, instruments);
    const [row] = await transaction
      .insert(investmentPlans)
      .values(
        userScoped(ctx).stamp({
          ...schedule,
          feeRate: feeRate === null ? null : fromBigint(feeRate, RATE_SCALE),
          investmentAccountId: investment.id,
          assetId: first,
          amountCents,
          fractions: false,
          mode: "propose" as const,
          model: "basket" as const,
          executionAmountCents: amountCents,
          createdOn: todayOn,
        }),
      )
      .returning({ id: investmentPlans.id });
    await writeInstruments(ctx, transaction, row.id, instruments);
    return { id: row.id };
  });
}

/** The asset of the heaviest instrument typed, made when missing, before the plan exists. */
async function heaviestAsset(
  ctx: Pick<Ctx, "userId">,
  transaction: Tx,
  instruments: z.output<typeof instrumentsSchema>,
): Promise<string> {
  const heaviest = [...instruments].sort((left, right) => right.weightBp - left.weightBp)[0];
  if ("id" in heaviest.asset) return (await requireAsset(ctx, heaviest.asset.id, transaction)).id;
  return (await assetOfInstrument(ctx, heaviest.asset.instrument, transaction)).id;
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
  const { feeRate, amountCents, instruments, frequency, interval, day, ...rest } = parsed;
  if (
    plan.model !== "basket" &&
    [amountCents, instruments, frequency, interval, day].some((one) => one !== undefined)
  ) {
    throw new RangeError(
      "Only a basket plan has instruments, an amount of each execution and a daily cadence",
    );
  }
  if ((frequency ?? plan.frequency) === "week" && (day ?? plan.day) > 7) {
    throw new RangeError("A day of the week is 1-7");
  }
  await getDb().transaction(async (transaction) => {
    if (instruments !== undefined) await writeInstruments(ctx, transaction, plan.id, instruments);
    await transaction
      .update(investmentPlans)
      .set({
        ...rest,
        ...feeChanges(parsed.feeCents, feeRate),
        ...basketChanges(plan, { amountCents, frequency, interval, day }, today(ctx.timeZone)),
        updatedAt: new Date(),
      })
      .where(and(eq(investmentPlans.id, plan.id), userScoped(ctx).owns(investmentPlans)));
  });
}

/** A fee is an amount or a rate: setting one clears the other. */
function feeChanges(feeCents: bigint | null | undefined, feeRate: bigint | null | undefined) {
  return {
    ...(feeRate === undefined ? {} : { feeRate: feeRate === null ? null : fromBigint(feeRate, RATE_SCALE) }),
    ...(feeCents !== undefined && feeCents !== null ? { feeRate: null } : {}),
    ...(feeRate !== undefined && feeRate !== null ? { feeCents: null } : {}),
  };
}

/**
 * A basket's amount and cadence. A new cadence, or the first amount of a converted plan, starts from
 * today: the job makes no execution of the days before (PERS-681 §3.5).
 */
function basketChanges(
  plan: InvestmentPlan,
  change: { amountCents?: bigint; frequency?: InvestmentPlan["frequency"]; interval?: number; day?: number },
  todayOn: CivilDate,
) {
  const { amountCents, frequency, interval, day } = change;
  const reschedule = frequency !== undefined || interval !== undefined || day !== undefined;
  const restart = reschedule || (amountCents !== undefined && plan.executionAmountCents === null);
  return {
    ...(frequency === undefined ? {} : { frequency }),
    ...(interval === undefined ? {} : { interval }),
    ...(day === undefined ? {} : { day }),
    ...(amountCents === undefined ? {} : { executionAmountCents: amountCents }),
    ...(reschedule && plan.startOn < todayOn ? { startOn: todayOn } : {}),
    ...(restart ? { createdOn: todayOn } : {}),
  };
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

/** The purchases plans wrote, of some events or of some instalments, with their plan and instalment. */
async function planPurchases(ctx: Pick<Ctx, "userId">, among: { eventIds?: string[]; runIds?: string[] }) {
  if (among.eventIds?.length === 0 || among.runIds?.length === 0) return [];
  const which = among.eventIds
    ? inArray(investmentOperations.eventId, among.eventIds)
    : inArray(investmentPlanRuns.id, among.runIds ?? []);
  return getDb()
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
    .where(and(userScoped(ctx).owns(investmentOperations), which));
}

/** The purchase each instalment wrote, by instalment. */
export async function eventsOfRuns(
  ctx: Pick<Ctx, "userId">,
  runIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await planPurchases(ctx, { runIds: [...runIds] });
  return new Map(rows.map((row) => [row.runId, row.eventId]));
}

/** The purchases of basket plans among some events: tied by the line of the execution (PERS-681 §3.4). */
async function basketPurchases(ctx: Pick<Ctx, "userId">, eventIds: string[]) {
  if (eventIds.length === 0) return [];
  const rows = await getDb()
    .select({
      eventId: investmentPlanRunLines.eventId,
      runId: investmentPlanRuns.id,
      planId: investmentPlans.id,
      name: investmentPlans.name,
      recordedBy: investmentPlanRuns.recordedBy,
    })
    .from(investmentPlanRunLines)
    .innerJoin(investmentPlanRuns, eq(investmentPlanRuns.id, investmentPlanRunLines.runId))
    .innerJoin(investmentPlans, eq(investmentPlans.id, investmentPlanRuns.planId))
    .where(
      and(userScoped(ctx).owns(investmentPlanRunLines), inArray(investmentPlanRunLines.eventId, eventIds)),
    );
  return rows.flatMap((row) => (row.eventId === null ? [] : [{ ...row, eventId: row.eventId }]));
}

/** The plan and the instalment of each purchase a plan wrote, by event: the activity's «automatic» mark. */
export async function plansOfEvents(
  ctx: Pick<Ctx, "userId">,
  eventIds: readonly string[],
): Promise<Map<string, { planId: string; runId: string; name: string; automatic: boolean }>> {
  const rows = [
    ...(await planPurchases(ctx, { eventIds: [...eventIds] })),
    ...(await basketPurchases(ctx, [...eventIds])),
  ];
  return new Map(
    rows.map((row) => [
      row.eventId,
      { planId: row.planId, runId: row.runId, name: row.name, automatic: row.recordedBy === "job" },
    ]),
  );
}

/** An instalment of the plan, locked for the transaction, or `not_found`. */
export async function lockRun(
  ctx: Pick<Ctx, "userId">,
  plan: InvestmentPlan,
  runId: string,
  transaction: Tx,
) {
  const [run] = await transaction
    .select()
    .from(investmentPlanRuns)
    .where(
      and(
        userScoped(ctx).owns(investmentPlanRuns),
        eq(investmentPlanRuns.id, runId),
        eq(investmentPlanRuns.planId, plan.id),
      ),
    )
    .for("update");
  if (!run) throw new InvestmentError("not_found");
  return run;
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
    const run = await lockRun(ctx, plan, runId, transaction);
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
