// What the pages read of the purchase plans (rewrite plan R5d, step 2): a portfolio's plans with their
// next due date, a plan's instalments with their proposal and bank movement, and the past due dates
// «Record the past instalments» offers (P4), each priced at its close when the registry has one.
import { and, desc, eq, inArray } from "drizzle-orm";
import { getTransaction } from "../../transactions/queries";
import type { Ctx } from "../../../platform/context";
import { addDays, type CivilDate, civilDateIn, today } from "../../../shared/dates";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type Cents, parseDecimal } from "../../../shared/money";
import { PORTFOLIO_PROVIDER } from "../catalog";
import { dueDates, instalment, MAX_BACKFILL_RUNS, PRICE_SCALE } from "../rules";
import { investmentAssets, investmentPlanRuns, investmentPlans } from "../schema";
import { requireInvestmentAccount } from "./book";
import { pricedListingOf } from "./market";
import { marketPrices } from "../ports";
import {
  eventsOfRuns,
  type InvestmentPlan,
  type InvestmentPlanRun,
  requirePlan,
  scheduleOf,
  sizeOf,
} from "./plans";
import { fromNumeric } from "./types";

/** A plan as the pages list it: its asset, its next due date and the instalments waiting. */
export interface PlanView {
  plan: InvestmentPlan;
  asset: { id: string; name: string; instrumentId: string | null; mic: string | null; currency: string };
  nextDueOn: CivilDate | null;
  toConfirm: number;
  waitingPrice: number;
}

export async function listPlans(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
): Promise<PlanView[]> {
  const investment = await requireInvestmentAccount(ctx, accountId);
  // A synced service, or one by value, has no plan: none to list (§11.3).
  if (investment.provider !== PORTFOLIO_PROVIDER) return [];
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
      asset: {
        id: asset.id,
        name: asset.name,
        instrumentId: asset.instrumentId,
        mic: asset.mic,
        currency: asset.currency,
      },
      nextDueOn: next,
      toConfirm: own.filter((run) => run.state === "proposed").length,
      waitingPrice: own.filter((run) => run.state === "waiting_price").length,
    };
  });
}

/** The asset a plan buys: its currency is the one of the plan's amounts and prices. */
async function assetOfPlan(plan: InvestmentPlan) {
  const [asset] = await getDb().select().from(investmentAssets).where(eq(investmentAssets.id, plan.assetId));
  return asset;
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
  /** The currency of the price and of the proposal: the asset's. */
  currency: string;
  proposal: { on: CivilDate; quantity: bigint; unitPrice: bigint; spentCents: Cents; feeCents: Cents } | null;
  eventId: string | null;
  debit: {
    transactionId: string;
    on: CivilDate;
    cents: Cents;
    currency: string;
    payee: string | null;
    linked: boolean;
  } | null;
}

export async function listRuns(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  planId: string,
): Promise<RunView[]> {
  const plan = await requirePlan(ctx, accountId, planId);
  const { currency } = await assetOfPlan(plan);
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
      return { run, currency, proposal, eventId: events.get(run.id) ?? null, debit: await debitOf(ctx, run) };
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
    currency: movement.currency,
    payee: movement.payee,
    linked: run.debitLinked,
  };
}

/** The closes of the market a plan buys on, oldest first, up to `to`: none when no source prices it. */
export async function closesOfPlan(plan: InvestmentPlan, to: CivilDate) {
  const asset = await assetOfPlan(plan);
  const listingId = (await pricedListingOf([asset])).get(asset.id);
  if (listingId === undefined) return [];
  return marketPrices().closesUpTo([listingId], to);
}

/** The past due dates «Record the past instalments» offers (P4), oldest first. */
export interface PastRuns {
  currency: string;
  runs: {
    dueOn: CivilDate;
    price: { unitPrice: bigint; on: CivilDate } | null;
    proposal: {
      on: CivilDate;
      quantity: bigint;
      unitPrice: bigint;
      spentCents: Cents;
      feeCents: Cents;
    } | null;
  }[];
  more: boolean;
}

/**
 * The due dates before the plan was made with nothing recorded or skipped — the job writes the later
 * ones — at most 60, oldest first; each priced at the first close on or after it, when there is one.
 */
export async function listPastRuns(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  accountId: string,
  planId: string,
): Promise<PastRuns> {
  const plan = await requirePlan(ctx, accountId, planId);
  const done = new Set(
    (await runsOf(ctx, [plan.id]))
      .filter((run) => run.state === "recorded" || run.state === "skipped")
      .map((run) => run.dueOn),
  );
  const past = dueDates(scheduleOf(plan), addDays(plan.createdOn, -1)).filter((day) => !done.has(day));
  const [asset, closes] = await Promise.all([assetOfPlan(plan), closesOfPlan(plan, today(ctx.timeZone))]);
  const runs = past.slice(0, MAX_BACKFILL_RUNS).map((dueOn) => {
    const close = closes.find((one) => one.on >= dueOn);
    if (!close) return { dueOn, price: null, proposal: null };
    const unitPrice = parseDecimal(close.close, PRICE_SCALE);
    return {
      dueOn,
      price: { unitPrice, on: close.on },
      proposal: { on: close.on, unitPrice, ...instalment(sizeOf(plan), unitPrice) },
    };
  });
  return { currency: asset.currency, runs, more: past.length > MAX_BACKFILL_RUNS };
}
