// The instalments of the purchase plans (rewrite plan R5d, step 2; 11-standardization.md §11.3.2): the
// daily job that makes the due dates and prices them, and what the person does with one — confirm,
// skip, record the past ones. A purchase and its instalment's state are written in one transaction.
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getAccount } from "../../accounts";
import { matchMovements } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, today } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { civilDate } from "../../../shared/inputs";
import { PORTFOLIO_PROVIDER } from "../catalog";
import {
  dueDates,
  endedBy,
  instalment,
  MAX_BACKFILL_RUNS,
  MAX_CATCH_UP,
  PLAN_RUN_REASONS,
  type PlanRunReason,
  PRICE_SCALE,
} from "../rules";
import { investmentAccounts, investmentEvents, investmentPlanRuns, investmentPlans } from "../schema";
import { buyWithin, positive } from "./events";
import { marketPrices } from "../ports";
import {
  type InvestmentPlan,
  type InvestmentPlanRun,
  lockRun,
  requirePlan,
  scheduleOf,
  sizeOf,
} from "./plans";
import { fromNumeric, InvestmentError, type WriteCtx } from "./types";
import { closesOfPlan } from "./plan-views";
import { advanceBasket, runsThePlan, skippedCarry } from "./plan-baskets";

/** The days after its due date a bank movement may document an instalment (E7). */
const DEBIT_WINDOW_DAYS = 5;
/** What a purchase refusal of the job becomes (P2): a proposal that says why. */
const reasonOf = (code: string) => PLAN_RUN_REASONS.find((reason) => reason === code);

const confirmSchema = z.object({
  on: civilDate().optional(),
  quantity: positive.optional(),
  unitPrice: positive.optional(),
  feeCents: z.bigint().nonnegative().optional(),
});
export type RunConfirmation = z.input<typeof confirmSchema>;

async function requireRun(ctx: Pick<Ctx, "userId">, plan: InvestmentPlan, runId: string, transaction: Tx) {
  const run = await lockRun(ctx, plan, runId, transaction);
  if (run.state === "recorded" || run.state === "skipped" || run.state === "expired") {
    throw new InvestmentError("not_editable");
  }
  return run;
}

/** The purchase of an instalment at a price, inside `transaction`, tied to it; then its state `recorded`. */
async function recordRun(
  ctx: WriteCtx,
  transaction: Tx,
  input: {
    plan: InvestmentPlan;
    run: InvestmentPlanRun;
    on: CivilDate;
    unitPrice: bigint;
    by: "person" | "job";
  },
  corrections: { quantity?: bigint; feeCents?: bigint } = {},
): Promise<string> {
  const { plan, run } = input;
  const [owner] = await transaction
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.id, plan.investmentAccountId));
  const account = await getAccount(ctx, owner.accountId);
  if (!account) throw new InvestmentError("not_found");
  const sized = instalment(sizeOf(plan), input.unitPrice);
  const quantity = corrections.quantity ?? sized.quantity;
  if (quantity <= 0n) throw new InvestmentError("negative_cash");
  const { eventId } = await buyWithin(ctx, transaction, {
    account,
    planRunId: run.id,
    input: {
      asset: { id: plan.assetId },
      product: "custody",
      on: input.on,
      quantity,
      unitPrice: input.unitPrice,
      totalCents: null,
      feeCents: corrections.feeCents ?? sized.feeCents,
      fxRate: null,
      note: null,
    },
  });
  await transaction
    .update(investmentPlanRuns)
    .set({ state: "recorded", recordedBy: input.by, reason: null, updatedAt: new Date() })
    .where(eq(investmentPlanRuns.id, run.id));
  return eventId;
}

/**
 * Confirms an instalment with the corrections typed (§11.3.3): the purchase as by hand, never a deposit
 * (P1 B). Its price is the one typed, or the close found; with neither it is `invalid`.
 */
export async function confirmRun(
  ctx: WriteCtx,
  ref: { accountId: string; planId: string; runId: string },
  input: RunConfirmation,
): Promise<{ eventId: string }> {
  const parsed = confirmSchema.parse(input);
  const plan = await requirePlan(ctx, ref.accountId, ref.planId);
  // A basket's execution has lines (PERS-681): `confirmBasketRun`.
  if (plan.model === "basket") throw new RangeError("A basket's execution is confirmed by its lines");
  return getDb().transaction(async (transaction) => {
    const run = await requireRun(ctx, plan, ref.runId, transaction);
    const unitPrice = parsed.unitPrice ?? fromNumeric(run.price, PRICE_SCALE);
    if (unitPrice === null) throw new RangeError("An instalment with no price needs one");
    const day = parsed.on ?? run.priceOn ?? run.dueOn;
    const eventId = await recordRun(
      ctx,
      transaction,
      { plan, run, on: day, unitPrice, by: "person" },
      parsed,
    );
    return { eventId };
  });
}

export async function skipRun(
  ctx: WriteCtx,
  ref: { accountId: string; planId: string; runId: string },
): Promise<void> {
  const plan = await requirePlan(ctx, ref.accountId, ref.planId);
  await getDb().transaction(async (transaction) => {
    const run = await requireRun(ctx, plan, ref.runId, transaction);
    await transaction
      .update(investmentPlanRuns)
      .set({ state: "skipped", reason: null, ...skippedCarry(run), updatedAt: new Date() })
      .where(eq(investmentPlanRuns.id, run.id));
  });
}

const backfillSchema = z.object({
  runs: z
    .array(
      z.object({
        dueOn: civilDate(),
        on: civilDate(),
        quantity: positive,
        unitPrice: positive,
        feeCents: z.bigint().nonnegative().nullable().default(null),
      }),
    )
    .min(1)
    .max(MAX_BACKFILL_RUNS),
});
export type Backfill = z.input<typeof backfillSchema>;

/**
 * «Record the past instalments» (§11.3.3, P4): a purchase for each due date given, all or none. A date
 * that is not one of the plan's, or one already recorded or skipped, refuses the whole.
 */
export async function backfillPlan(
  ctx: WriteCtx,
  ref: { accountId: string; planId: string },
  input: Backfill,
): Promise<{ eventIds: string[] }> {
  const parsed = backfillSchema.parse(input);
  const plan = await requirePlan(ctx, ref.accountId, ref.planId);
  // A basket has no past executions: a past purchase is recorded by hand (PERS-681 §5).
  if (plan.model === "basket") throw new InvestmentError("plan_model_retired");
  const dates = new Set(dueDates(scheduleOf(plan), today(ctx.timeZone)));
  if (parsed.runs.some((row) => !dates.has(row.dueOn))) throw new RangeError("Not a due date of the plan");
  return getDb().transaction(async (transaction) => {
    const eventIds: string[] = [];
    for (const row of parsed.runs) {
      const run = await runOn(ctx, transaction, plan, row.dueOn);
      if (run.state === "recorded" || run.state === "skipped") throw new InvestmentError("not_editable");
      const corrections = {
        quantity: row.quantity,
        ...(row.feeCents === null ? {} : { feeCents: row.feeCents }),
      };
      eventIds.push(
        await recordRun(
          ctx,
          transaction,
          { plan, run, on: row.on, unitPrice: row.unitPrice, by: "person" },
          corrections,
        ),
      );
    }
    return { eventIds };
  });
}

/** The instalment of a due date, made when missing: the unique key keeps one, whoever makes it first. */
async function runOn(ctx: Pick<Ctx, "userId">, transaction: Tx, plan: InvestmentPlan, dueOn: CivilDate) {
  await transaction
    .insert(investmentPlanRuns)
    .values(userScoped(ctx).stamp({ planId: plan.id, dueOn }))
    .onConflictDoNothing({ target: [investmentPlanRuns.planId, investmentPlanRuns.dueOn] });
  const [run] = await transaction
    .select()
    .from(investmentPlanRuns)
    .where(and(eq(investmentPlanRuns.planId, plan.id), eq(investmentPlanRuns.dueOn, dueOn)))
    .for("update");
  return run;
}

/** The first close of the plan's market on or after the due date, and its day; null with none yet. */
async function priceOf(plan: InvestmentPlan, dueOn: CivilDate, todayOn: CivilDate) {
  const close = (await closesOfPlan(plan, todayOn)).find((one) => one.on >= dueOn);
  return close ? { price: close.close, currency: close.currency, on: close.on } : null;
}

/**
 * One instalment of the job (§11.3.2): no price yet, `waiting_price` (the person types it after 5
 * working days); a price and `propose`, `proposed`; a price and `auto`, the purchase — or, when the
 * purchase is refused (no cash, P2 A), `proposed` with its reason. All in the instalment's transaction.
 */
async function advance(
  ctx: WriteCtx,
  plan: InvestmentPlan,
  dueOn: CivilDate,
  todayOn: CivilDate,
): Promise<void> {
  const priced = await priceOf(plan, dueOn, todayOn);
  await getDb().transaction(async (transaction) => {
    const run = await runOn(ctx, transaction, plan, dueOn);
    if (run.state !== "pending" && run.state !== "waiting_price") return;
    if (priced === null) {
      await transaction
        .update(investmentPlanRuns)
        .set({ state: "waiting_price", waitingSince: run.waitingSince ?? todayOn, updatedAt: new Date() })
        .where(eq(investmentPlanRuns.id, run.id));
      return;
    }
    const price = { price: priced.price, priceCurrency: priced.currency, priceOn: priced.on };
    await transaction.update(investmentPlanRuns).set(price).where(eq(investmentPlanRuns.id, run.id));
    let reason: PlanRunReason | null = null;
    if (plan.mode === "auto") {
      const unitPrice = fromNumeric(priced.price, PRICE_SCALE) ?? 0n;
      try {
        // A savepoint: a refused purchase leaves nothing of itself, and the instalment becomes a proposal.
        await transaction.transaction((inner) =>
          recordRun(ctx, inner, { plan, run, on: priced.on, unitPrice, by: "job" }),
        );
        return;
      } catch (error) {
        const refusal = error instanceof InvestmentError ? reasonOf(error.code) : undefined;
        if (refusal === undefined) throw error;
        reason = refusal;
      }
    }
    await transaction
      .update(investmentPlanRuns)
      .set({ state: "proposed", reason, updatedAt: new Date() })
      .where(eq(investmentPlanRuns.id, run.id));
  });
}

/**
 * The movement of the debit account that may document an instalment (E7): out of that account, for
 * what it spent and its fee, from its due date to 5 days after, and documenting nothing else yet. The
 * match is proposed on the instalment; the person links it.
 */
async function proposeDebit(ctx: WriteCtx, plan: InvestmentPlan, run: InvestmentPlanRun): Promise<void> {
  const unitPrice = fromNumeric(run.price, PRICE_SCALE);
  if (plan.debitAccountId === null || unitPrice === null || run.debitTransactionId !== null) return;
  const sized = instalment(sizeOf(plan), unitPrice);
  const found = await matchMovements(ctx, {
    accountId: plan.debitAccountId,
    sign: "out",
    window: { from: run.dueOn, to: addDays(run.dueOn, DEBIT_WINDOW_DAYS) },
    amountCents: sized.spentCents + sized.feeCents,
  });
  if (found.length === 0) return;
  const taken = await getDb()
    .select({ id: investmentEvents.transactionId })
    .from(investmentEvents)
    .where(
      and(
        userScoped(ctx).owns(investmentEvents),
        inArray(
          investmentEvents.transactionId,
          found.map((one) => one.id),
        ),
      ),
    );
  const free = found.find((one) => !taken.some((row) => row.id === one.id));
  if (!free) return;
  await getDb()
    .update(investmentPlanRuns)
    .set({ debitTransactionId: free.id, updatedAt: new Date() })
    .where(eq(investmentPlanRuns.id, run.id));
}

/** The person's active plans of their manual portfolios. */
async function activePlans(ctx: Pick<Ctx, "userId">): Promise<InvestmentPlan[]> {
  const rows = await getDb()
    .select({ plan: investmentPlans })
    .from(investmentPlans)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentPlans.investmentAccountId))
    .where(
      and(
        userScoped(ctx).owns(investmentPlans),
        eq(investmentPlans.state, "active"),
        eq(investmentAccounts.provider, PORTFOLIO_PROVIDER),
      ),
    );
  return rows.map((row) => row.plan);
}

/**
 * `investment-plans-due` for one person (§11.3.2): for each active plan, the due dates up to today
 * that have no instalment — from the day the plan was made, at most the last 12 after a stop — then
 * every instalment still pending or waiting for a price. Twice in a day, or after a stop half way,
 * it writes nothing twice: one instalment a due date, one purchase an instalment.
 */
export async function runDuePlans(ctx: WriteCtx, now: Date = new Date()): Promise<{ advanced: number }> {
  const todayOn = today(ctx.timeZone, now);
  let advanced = 0;
  for (const plan of await activePlans(ctx)) {
    if (!runsThePlan(plan)) continue;
    const own = await getDb().select().from(investmentPlanRuns).where(eq(investmentPlanRuns.planId, plan.id));
    const known = new Map(own.map((run) => [run.dueOn, run]));
    const due = dueDates(scheduleOf(plan), todayOn).filter((day) => day >= plan.createdOn);
    const missing = due.filter((day) => !known.has(day)).slice(-MAX_CATCH_UP);
    const open = own
      .filter((run) => run.state === "pending" || run.state === "waiting_price")
      .map((run) => run.dueOn);
    for (const dueOn of [...new Set([...open, ...missing])].sort()) {
      await (plan.model === "basket" ? advanceBasket : advance)(ctx, plan, dueOn, todayOn);
      advanced += 1;
    }
    const after = await getDb()
      .select()
      .from(investmentPlanRuns)
      .where(eq(investmentPlanRuns.planId, plan.id));
    // shortcut: a basket's execution is several purchases, and a bank movement documents one event:
    // no debit match for baskets yet (PERS-681), upgrade when a movement can document several.
    for (const run of after)
      if (plan.model !== "basket" && (run.state === "proposed" || run.state === "recorded"))
        await proposeDebit(ctx, plan, run);
    if (endedBy(scheduleOf(plan), todayOn) && after.every((run) => run.dueOn <= todayOn)) {
      await getDb()
        .update(investmentPlans)
        .set({ state: "ended", updatedAt: new Date() })
        .where(eq(investmentPlans.id, plan.id));
    }
  }
  return { advanced };
}

/** «Da fare» of the plans (R5e): the instalments to confirm, and those with no price after 5 working days. */
export async function plansToDo(
  ctx: Pick<Ctx, "userId" | "timeZone">,
): Promise<{ toConfirm: PlanFact[]; priceMissing: PlanFact[]; amountMissing: PlanAmountFact[] }> {
  const todayOn = today(ctx.timeZone);
  const rows = await getDb()
    .select({
      run: investmentPlanRuns,
      accountId: investmentAccounts.accountId,
      model: investmentPlans.model,
    })
    .from(investmentPlanRuns)
    .innerJoin(investmentPlans, eq(investmentPlans.id, investmentPlanRuns.planId))
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentPlans.investmentAccountId))
    .where(
      and(
        userScoped(ctx).owns(investmentPlanRuns),
        inArray(investmentPlanRuns.state, ["proposed", "waiting_price"]),
      ),
    );
  const fact = (row: (typeof rows)[number]): PlanFact => ({
    runId: row.run.id,
    accountId: row.accountId,
    dueOn: row.run.dueOn,
    reason: row.run.reason,
  });
  const late = (row: (typeof rows)[number]) =>
    row.run.waitingSince !== null && marketPrices().isStale(row.run.waitingSince, todayOn);
  // A basket proposed with a line to type after 5 working days is a proposal: «price missing» too (§6).
  const lineToType = (row: (typeof rows)[number]) =>
    row.model === "basket" && row.run.state === "proposed" && row.run.waitingSince !== null;
  const amountMissing = await getDb()
    .select({ planId: investmentPlans.id, accountId: investmentAccounts.accountId })
    .from(investmentPlans)
    .innerJoin(investmentAccounts, eq(investmentAccounts.id, investmentPlans.investmentAccountId))
    .where(
      and(
        userScoped(ctx).owns(investmentPlans),
        eq(investmentPlans.model, "basket"),
        eq(investmentPlans.state, "active"),
        isNull(investmentPlans.executionAmountCents),
      ),
    );
  return {
    toConfirm: rows.filter((row) => row.run.state === "proposed" && !lineToType(row)).map(fact),
    priceMissing: rows
      .filter((row) => (row.run.state === "waiting_price" && late(row)) || lineToType(row))
      .map(fact),
    amountMissing,
  };
}

/** A converted basket with no amount yet (PERS-681 §3.5): its portfolio's page. */
interface PlanAmountFact {
  planId: string;
  accountId: string;
}

export interface PlanFact {
  runId: string;
  accountId: string;
  dueOn: CivilDate;
  /** Why the job did not write it (P2), or null. */
  reason: PlanRunReason | null;
}
