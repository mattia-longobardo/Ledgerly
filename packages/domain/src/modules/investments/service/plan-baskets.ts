// The executions of a basket plan (PERS-681, docs/design/investments-plans-whole-shares.md §4, §6): the
// job proposes the whole shares at each due date, with the carry of the executions before. What an
// execution does not spend is carried to the next one (M1); a skipped or expired one carries its whole
// budget (D2). The person's side — preview, confirmation — is `plan-proposals.ts`.
import { and, desc, eq, inArray, isNotNull, lt } from "drizzle-orm";
import { getAccount } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { formatDecimal, parseDecimal } from "../../../shared/money";
import {
  allocateWholeShares,
  type AllocationLine,
  dueDates,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
} from "../rules";
import { investmentAccounts, investmentAssets, investmentPlanRunLines, investmentPlanRuns } from "../schema";
import { marketPrices } from "../ports";
import { rateOf } from "./events";
import { pricedListingOf } from "./market";
import { instrumentsOf } from "./plan-instruments";
import { type InvestmentPlan, type InvestmentPlanRun, scheduleOf } from "./plans";
import { InvestmentError, type WriteCtx } from "./types";

export type PlanRunLine = typeof investmentPlanRunLines.$inferSelect;

/** The currency of a basket: its portfolio's account's, the one of its amount and its budget. */
export async function currencyOfPlan(ctx: Pick<Ctx, "userId">, plan: InvestmentPlan, transaction?: Tx) {
  const [owner] = await (transaction ?? getDb())
    .select({ accountId: investmentAccounts.accountId })
    .from(investmentAccounts)
    .where(eq(investmentAccounts.id, plan.investmentAccountId));
  const account = await getAccount(ctx, owner.accountId);
  if (!account) throw new InvestmentError("not_found");
  return account;
}

interface PricedLine {
  assetId: string;
  weightBp: number;
  /** The close found and its day, in the currency of its market. */
  close: { price: bigint; currency: string; on: CivilDate } | null;
  /** The ECB rate of the close's day to the plan's currency; null in the same currency. */
  rate: bigint | null;
  /** A close in another currency with no rate yet counts as no price (§6). */
  priced: boolean;
}

/** The first close of each instrument on or after the due date, and the ECB rate of its day (§6). */
async function priceLines(
  ctx: Pick<Ctx, "userId">,
  plan: InvestmentPlan,
  currency: string,
  days: { dueOn: CivilDate; todayOn: CivilDate },
): Promise<PricedLine[]> {
  const { dueOn, todayOn } = days;
  const rows = await instrumentsOf(ctx, [plan.id]);
  const listings = await pricedListingOf(rows.map((row) => row.asset));
  return Promise.all(
    rows.map(async ({ row, asset }): Promise<PricedLine> => {
      const base = { assetId: asset.id, weightBp: row.weightBp };
      const listingId = listings.get(asset.id);
      const found =
        listingId === undefined
          ? undefined
          : (await marketPrices().closesUpTo([listingId], todayOn)).find((one) => one.on >= dueOn);
      if (!found) return { ...base, close: null, rate: null, priced: false };
      const close = { price: parseDecimal(found.close, PRICE_SCALE), currency: found.currency, on: found.on };
      const { fxRate } = await rateOf(asset.currency, currency, found.on, null);
      return { ...base, close, rate: fxRate, priced: asset.currency === currency || fxRate !== null };
    }),
  );
}

/** The execution of a due date, made when missing; the unique key keeps one a due date. */
async function executionOn(
  ctx: Pick<Ctx, "userId">,
  transaction: Tx,
  plan: InvestmentPlan,
  dueOn: CivilDate,
): Promise<InvestmentPlanRun> {
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

/**
 * The budget of an execution, fixed when it becomes a proposal or closes (§4.3): a proposal still open
 * before it expires and carries its whole budget (D2) — at most one proposal a plan —, the carry in is
 * the carry out of the last closed one, and the budget is the amount plus that carry, never below 0
 * (§2.1). An execution still waiting for a price has none: the one before may still be confirmed.
 */
async function settleBudget(
  transaction: Tx,
  plan: InvestmentPlan,
  run: InvestmentPlanRun,
): Promise<{ budgetCents: bigint; carryInCents: bigint }> {
  const before = await transaction
    .select()
    .from(investmentPlanRuns)
    .where(
      and(
        eq(investmentPlanRuns.planId, plan.id),
        lt(investmentPlanRuns.dueOn, run.dueOn),
        eq(investmentPlanRuns.state, "proposed"),
      ),
    )
    .for("update");
  for (const open of before) {
    await transaction
      .update(investmentPlanRuns)
      .set({ state: "expired", carryOutCents: open.budgetCents ?? 0n, updatedAt: new Date() })
      .where(eq(investmentPlanRuns.id, open.id));
  }
  const [last] = await transaction
    .select({ carry: investmentPlanRuns.carryOutCents })
    .from(investmentPlanRuns)
    .where(
      and(
        eq(investmentPlanRuns.planId, plan.id),
        lt(investmentPlanRuns.dueOn, run.dueOn),
        isNotNull(investmentPlanRuns.carryOutCents),
      ),
    )
    .orderBy(desc(investmentPlanRuns.dueOn))
    .limit(1);
  const carryInCents = last?.carry ?? 0n;
  const budget = (plan.executionAmountCents ?? 0n) + carryInCents;
  const settled = { budgetCents: budget > 0n ? budget : 0n, carryInCents };
  await transaction
    .update(investmentPlanRuns)
    .set({ ...settled, updatedAt: new Date() })
    .where(eq(investmentPlanRuns.id, run.id));
  return settled;
}

/**
 * A working day whose first close is the one of a later due date of the plan: the market was closed
 * that day (§3.1), and the later execution buys at that close.
 */
function marketClosed(plan: InvestmentPlan, dueOn: CivilDate, priced: readonly PricedLine[]): boolean {
  const firstOn = priced.reduce<CivilDate | null>(
    (min, line) => (line.close !== null && (min === null || line.close.on < min) ? line.close.on : min),
    null,
  );
  if (firstOn === null || firstOn <= dueOn) return false;
  return dueDates(scheduleOf(plan), firstOn).some((day) => day > dueOn && day <= firstOn);
}

const lineRow = (line: AllocationLine, priced: PricedLine) => ({
  assetId: line.assetId,
  weightBp: line.weightBp,
  price: priced.close === null ? null : formatDecimal(priced.close.price, PRICE_SCALE),
  priceCurrency: priced.close?.currency ?? null,
  priceOn: priced.close?.on ?? null,
  fxRate: priced.rate === null ? null : formatDecimal(priced.rate, RATE_SCALE),
  targetCents: line.targetCents,
  quantity: formatDecimal(line.quantity, QUANTITY_SCALE),
  spentCents: line.spentCents,
  state: line.state,
});

/**
 * One execution of the job (§4.1, §6): every price there, a proposal; a price missing, `waiting_price`
 * and a new try each day, then after 5 working days a proposal with that line to type. A working day
 * whose first close is the one of a later due date is `market_closed`: skipped, and its amount not
 * added (§3.1). All in the execution's transaction; twice in a day writes nothing twice.
 */
export async function advanceBasket(
  ctx: WriteCtx,
  plan: InvestmentPlan,
  dueOn: CivilDate,
  todayOn: CivilDate,
): Promise<void> {
  const { currency } = await currencyOfPlan(ctx, plan);
  const priced = await priceLines(ctx, plan, currency, { dueOn, todayOn });
  await getDb().transaction(async (transaction) => {
    const run = await executionOn(ctx, transaction, plan, dueOn);
    if (run.state !== "pending" && run.state !== "waiting_price") return;
    const waitingSince = run.waitingSince ?? todayOn;
    const missing = priced.some((line) => !line.priced);
    if (missing && !marketPrices().isStale(waitingSince, todayOn)) {
      await transaction
        .update(investmentPlanRuns)
        .set({ state: "waiting_price", waitingSince, updatedAt: new Date() })
        .where(eq(investmentPlanRuns.id, run.id));
      return;
    }
    // The later execution has a close too: its proposal comes in this same run of the job.
    const { budgetCents, carryInCents } = await settleBudget(transaction, plan, run);
    const closed = !missing && marketClosed(plan, dueOn, priced);
    if (closed) {
      await transaction
        .update(investmentPlanRuns)
        .set({
          state: "skipped",
          reason: "market_closed",
          carryOutCents: carryInCents,
          updatedAt: new Date(),
        })
        .where(eq(investmentPlanRuns.id, run.id));
      return;
    }
    const allocation = allocateWholeShares(
      budgetCents,
      priced.map((line) => ({
        assetId: line.assetId,
        weightBp: line.weightBp,
        unitPrice: line.priced ? (line.close?.price ?? null) : null,
        rate: line.rate,
      })),
    );
    await transaction
      .insert(investmentPlanRunLines)
      .values(
        allocation.lines.map((line, index) =>
          userScoped(ctx).stamp({ runId: run.id, ...lineRow(line, priced[index]) }),
        ),
      );
    await transaction
      .update(investmentPlanRuns)
      .set({ state: "proposed", waitingSince: missing ? waitingSince : null, updatedAt: new Date() })
      .where(eq(investmentPlanRuns.id, run.id));
  });
}

/** The lines of some executions, with the name and the currency of their asset. */
export async function linesOf(ctx: Pick<Ctx, "userId">, runIds: readonly string[], transaction?: Tx) {
  if (runIds.length === 0) return [];
  return (transaction ?? getDb())
    .select({
      line: investmentPlanRunLines,
      name: investmentAssets.name,
      currency: investmentAssets.currency,
    })
    .from(investmentPlanRunLines)
    .innerJoin(investmentAssets, eq(investmentAssets.id, investmentPlanRunLines.assetId))
    .where(
      and(userScoped(ctx).owns(investmentPlanRunLines), inArray(investmentPlanRunLines.runId, [...runIds])),
    )
    .orderBy(desc(investmentPlanRunLines.weightBp), investmentAssets.name);
}

/**
 * A skipped basket execution carries its whole budget to the next one (M1, D2); one still waiting
 * for a price fixes it first. An instalment of R5d carries nothing.
 */
export async function skippedCarry(transaction: Tx, plan: InvestmentPlan, run: InvestmentPlanRun) {
  if (plan.model !== "basket") return {};
  const budgetCents = run.budgetCents ?? (await settleBudget(transaction, plan, run)).budgetCents;
  return { carryOutCents: budgetCents };
}

/** The carry of a plan now: the carry out of its last closed execution, 0 with none. */
export async function carryOfPlans(ctx: Pick<Ctx, "userId">, planIds: readonly string[]) {
  const carry = new Map<string, bigint>();
  if (planIds.length === 0) return carry;
  const rows = await getDb()
    .select({ planId: investmentPlanRuns.planId, carry: investmentPlanRuns.carryOutCents })
    .from(investmentPlanRuns)
    .where(
      and(
        userScoped(ctx).owns(investmentPlanRuns),
        inArray(investmentPlanRuns.planId, [...planIds]),
        isNotNull(investmentPlanRuns.carryOutCents),
      ),
    )
    .orderBy(desc(investmentPlanRuns.dueOn));
  for (const row of rows) if (!carry.has(row.planId)) carry.set(row.planId, row.carry ?? 0n);
  return carry;
}

/** Whether the job runs a plan: not a basket with no amount yet (§3.5), which «Da fare» asks for. */
export const runsThePlan = (plan: InvestmentPlan) =>
  plan.model !== "basket" || plan.executionAmountCents !== null;
