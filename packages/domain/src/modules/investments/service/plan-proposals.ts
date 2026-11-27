// A basket's proposal on the person's side (PERS-681, docs/design/investments-plans-whole-shares.md §2.4,
// §4.3, §5): the preview of the corrections typed — the one place of the computation, nothing written —
// and the confirmation, one purchase a line with shares, all of them or none. Fees are outside the
// budget (D1); what is not spent goes to the next execution (M1).
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { getDb, type Tx } from "../../../platform/db/client";
import { formatDecimal } from "../../../shared/money";
import { civilDate } from "../../../shared/inputs";
import { allocateWholeShares, planFee, PRICE_SCALE, QUANTITY_SCALE, RATE_SCALE, spentAt } from "../rules";
import { investmentOperations, investmentPlanRunLines, investmentPlanRuns } from "../schema";
import { buyWithin, positive, rateOf } from "./events";
import { currencyOfPlan, linesOf, type PlanRunLine } from "./plan-baskets";
import { type InvestmentPlan, type InvestmentPlanRun, lockRun, requirePlan } from "./plans";
import { fromNumeric, InvestmentError, type WriteCtx } from "./types";

type Lines = Awaited<ReturnType<typeof linesOf>>;

/** Whole shares only (§2): a quantity typed with a fraction is refused, as `invalid`. */
const wholeShares = z
  .bigint()
  .nonnegative()
  .refine((quantity) => quantity % 10n ** BigInt(QUANTITY_SCALE) === 0n, "Whole shares only");

const correctionSchema = z.object({
  lines: z
    .array(
      z.object({
        assetId: z.uuid(),
        unitPrice: positive.optional(),
        quantity: wholeShares.optional(),
      }),
    )
    .default([]),
});
type RunPreview = z.input<typeof correctionSchema>;

/** An execution's line as a preview computes it: the stored one with the corrections. */
export interface PreviewLine {
  assetId: string;
  weightBp: number;
  unitPrice: bigint | null;
  rate: bigint | null;
  targetCents: bigint;
  quantity: bigint;
  spentCents: bigint;
  state: PlanRunLine["state"];
}

/**
 * The lines with the prices and the quantities typed (§2.4): a price typed alone gives the shares
 * the allocation proposes at it; a quantity typed wins. The one place of the computation: the page
 * computes nothing.
 */
async function corrected(
  run: InvestmentPlanRun,
  lines: Lines,
  currency: string,
  input: z.output<typeof correctionSchema>["lines"],
): Promise<{ lines: PreviewLine[]; spentCents: bigint }> {
  const typed = new Map(input.map((line) => [line.assetId, line]));
  if ([...typed.keys()].some((assetId) => !lines.some((one) => one.line.assetId === assetId))) {
    throw new RangeError("An instrument that is not in the execution");
  }
  const inputs = await Promise.all(
    lines.map(async ({ line, currency: assetCurrency }) => {
      const unitPrice = typed.get(line.assetId)?.unitPrice ?? fromNumeric(line.price, PRICE_SCALE);
      let rate = fromNumeric(line.fxRate, RATE_SCALE);
      if (rate === null && assetCurrency !== currency) {
        rate = (await rateOf(assetCurrency, currency, line.priceOn ?? run.dueOn, null)).fxRate;
      }
      const priced = assetCurrency === currency || rate !== null;
      return { assetId: line.assetId, weightBp: line.weightBp, unitPrice: priced ? unitPrice : null, rate };
    }),
  );
  const allocation = allocateWholeShares(run.budgetCents ?? 0n, inputs);
  const result = allocation.lines.map((line): PreviewLine => {
    const quantity = typed.get(line.assetId)?.quantity;
    if (quantity === undefined) return line;
    const spentCents = line.unitPrice === null ? 0n : spentAt(quantity, line.unitPrice, line.rate);
    return { ...line, quantity, spentCents, state: lineStateOf(quantity, line.state) };
  });
  return { lines: result, spentCents: result.reduce((sum, line) => sum + line.spentCents, 0n) };
}

/** A line typed with shares buys them; one set to 0 that the job proposed to buy is `skipped`. */
const lineStateOf = (quantity: bigint, proposed: PlanRunLine["state"]): PlanRunLine["state"] =>
  quantity > 0n ? "buy" : proposed === "buy" ? "skipped" : proposed;

/** A proposal of a basket, locked, or `not_editable`: one recorded, skipped or expired cannot change. */
async function requireProposal(
  ctx: Pick<Ctx, "userId">,
  plan: InvestmentPlan,
  runId: string,
  transaction: Tx,
): Promise<InvestmentPlanRun> {
  const run = await lockRun(ctx, plan, runId, transaction);
  if (run.state !== "proposed") throw new InvestmentError("not_editable");
  return run;
}

/** «Rivedi la proposta» (§2.4, §5): the execution with the corrections typed; nothing written. */
export async function previewRun(
  ctx: WriteCtx,
  ref: { accountId: string; planId: string; runId: string },
  input: RunPreview,
): Promise<{
  run: InvestmentPlanRun;
  currency: string;
  names: Map<string, string>;
  lines: PreviewLine[];
  spentCents: bigint;
  carryOutCents: bigint;
}> {
  const parsed = correctionSchema.parse(input);
  const plan = await requireBasket(ctx, ref);
  const { currency } = await currencyOfPlan(ctx, plan);
  return getDb().transaction(async (transaction) => {
    const run = await requireProposal(ctx, plan, ref.runId, transaction);
    const lines = await linesOf(ctx, [run.id], transaction);
    const result = await corrected(run, lines, currency, parsed.lines);
    const names = new Map(lines.map((one) => [one.line.assetId, one.name]));
    return { run, currency, names, ...result, carryOutCents: (run.budgetCents ?? 0n) - result.spentCents };
  });
}

async function requireBasket(ctx: Pick<Ctx, "userId">, ref: { accountId: string; planId: string }) {
  const plan = await requirePlan(ctx, ref.accountId, ref.planId);
  if (plan.model !== "basket") throw new InvestmentError("not_editable");
  return plan;
}

const confirmSchema = z.object({
  on: civilDate().optional(),
  lines: z
    .array(
      z
        .object({
          assetId: z.uuid(),
          quantity: wholeShares,
          // A line with no price (§6 `price_missing`) is confirmed with 0 shares: it buys nothing.
          unitPrice: positive.optional(),
          feeCents: z.bigint().nonnegative().optional(),
        })
        .refine(
          (line) => line.quantity === 0n || line.unitPrice !== undefined,
          "A line with shares needs a price",
        )
        .refine(
          (line) => line.quantity > 0n || !line.feeCents,
          "A line with 0 shares buys nothing: it has no fee",
        ),
    )
    .min(1),
});
type BasketConfirmation = z.input<typeof confirmSchema>;

/**
 * Confirms a basket's proposal (§4.3): a purchase for each line with shares, as by hand and never a
 * deposit, all of them or none in one transaction — `negative_cash` writes nothing. Every line of the
 * execution is given, each once; a line with 0 shares buys nothing. The carry out is the budget less
 * what the purchases cost in the portfolio's currency; fees are outside it (D1).
 */
export async function confirmBasketRun(
  ctx: WriteCtx,
  ref: { accountId: string; planId: string; runId: string },
  input: BasketConfirmation,
): Promise<{ eventIds: string[] }> {
  const parsed = confirmSchema.parse(input);
  const plan = await requireBasket(ctx, ref);
  const account = await currencyOfPlan(ctx, plan);
  return getDb().transaction(async (transaction) => {
    const run = await requireProposal(ctx, plan, ref.runId, transaction);
    const lines = await linesOf(ctx, [run.id], transaction);
    const given = givenLines(lines, parsed.lines);
    const day = parsed.on ?? latestPriceDay(lines) ?? run.dueOn;
    const eventIds: string[] = [];
    let spentCents = 0n;
    for (const { line, currency } of lines) {
      const typed = given.get(line.assetId)!;
      if (typed.quantity === 0n) {
        await transaction
          .update(investmentPlanRunLines)
          .set({
            quantity: formatDecimal(0n, QUANTITY_SCALE),
            spentCents: 0n,
            state: lineStateOf(0n, line.state),
          })
          .where(eq(investmentPlanRunLines.id, line.id));
        continue;
      }
      const bought = await buyLine(ctx, transaction, {
        plan,
        account,
        line,
        currency,
        typed: { ...typed, unitPrice: typed.unitPrice! },
        day,
      });
      spentCents += bought.spentCents;
      eventIds.push(bought.eventId);
    }
    await transaction
      .update(investmentPlanRuns)
      .set({
        state: "recorded",
        recordedBy: "person",
        reason: null,
        carryOutCents: (run.budgetCents ?? 0n) - spentCents,
        updatedAt: new Date(),
      })
      .where(eq(investmentPlanRuns.id, run.id));
    return { eventIds };
  });
}

type TypedLine = z.output<typeof confirmSchema>["lines"][number];

/** The lines typed, by asset: every line of the execution, each once, and at least one with shares. */
function givenLines(lines: Lines, typed: readonly TypedLine[]): Map<string, TypedLine> {
  const given = new Map(typed.map((line) => [line.assetId, line]));
  if (given.size !== typed.length || given.size !== lines.length) {
    throw new RangeError("Every line of the execution, each once");
  }
  if (lines.some(({ line }) => !given.has(line.assetId))) {
    throw new RangeError("An instrument that is not in the execution");
  }
  if (typed.every((line) => line.quantity === 0n)) throw new RangeError("Nothing to buy: skip it");
  return given;
}

/** The purchase of a line, as by hand (the ECB rate of its day), and the line as confirmed. */
async function buyLine(
  ctx: WriteCtx,
  transaction: Tx,
  input: {
    plan: InvestmentPlan;
    account: { id: string; currency: string };
    line: PlanRunLine;
    /** The asset's currency, the one of its price and of a fee typed on the line. */
    currency: string;
    typed: TypedLine & { unitPrice: bigint };
    day: CivilDate;
  },
): Promise<{ eventId: string; spentCents: bigint }> {
  const { plan, account, line, typed } = input;
  // The plan's fixed fee is in the plan's currency (the account's); a purchase takes it in the asset's.
  const feeCents =
    plan.feeCents === null
      ? null
      : (await rateOf(account.currency, input.currency, input.day, null)).inAccount(plan.feeCents);
  const fee = { cents: feeCents, rate: fromNumeric(plan.feeRate, RATE_SCALE) };
  const { eventId } = await buyWithin(ctx, transaction, {
    account,
    input: {
      asset: { id: line.assetId },
      product: "custody",
      on: input.day,
      quantity: typed.quantity,
      unitPrice: typed.unitPrice,
      totalCents: null,
      feeCents: typed.feeCents ?? planFee(fee, spentAt(typed.quantity, typed.unitPrice, null)),
      fxRate: null,
      note: null,
    },
  });
  const spentCents = await spentOf(transaction, eventId);
  await transaction
    .update(investmentPlanRunLines)
    .set({
      quantity: formatDecimal(typed.quantity, QUANTITY_SCALE),
      price: formatDecimal(typed.unitPrice, PRICE_SCALE),
      spentCents,
      state: "buy",
      eventId,
    })
    .where(eq(investmentPlanRunLines.id, line.id));
  return { eventId, spentCents };
}

const latestPriceDay = (lines: Lines) =>
  lines.reduce<CivilDate | null>(
    (max, { line }) => (line.priceOn !== null && (max === null || line.priceOn > max) ? line.priceOn : max),
    null,
  );

/** What a purchase cost in the portfolio's currency: its main leg, without the fee (D1). */
async function spentOf(transaction: Tx, eventId: string): Promise<bigint> {
  const [main] = await transaction
    .select({ cents: investmentOperations.amountCents })
    .from(investmentOperations)
    .where(and(eq(investmentOperations.eventId, eventId), eq(investmentOperations.leg, "main")));
  return -main.cents;
}
