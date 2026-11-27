// Investments · the routes of the purchase plans (rewrite plan R5d, step 2; 11-standardization.md
// §11.3): the plans of a manual portfolio, their instalments, a confirmation, a skip, the past
// instalments and the link to the bank movement. Canonical numbers in, the domain's fixed point out.
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS } from "@ledgerly/api-contract";
import {
  backfillPlan,
  confirmBasketRun,
  confirmRun,
  createBasketPlan,
  linkRunDebit,
  listPastRuns,
  listPlans,
  listRuns,
  type PastRuns,
  type PlanView,
  type PreviewLine,
  previewRun,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  type RunView,
  skipRun,
  updatePlan,
} from "@ledgerly/domain/investments";
import {
  centsToDecimal,
  formatDecimal,
  parseDecimal,
  percentToFraction,
} from "@ledgerly/domain/shared/money";
import { type ApiEnv, type Guard, serve } from "../serve";
import { maybe } from "./dto";
import { cents, decimal, refusing } from "./refusals";

const { plans } = INVESTMENTS;

type FeeBody = z.output<typeof plans.createPlan.body>["fee"];
type InstrumentsBody = z.output<typeof plans.createPlan.body>["instruments"];

/** A weight in percent ("33.33") is basis points in the domain (3333). */
const weightBp = (weight: string) => Number(parseDecimal(weight, 2));
const weightOut = (basisPoints: number) => formatDecimal(BigInt(basisPoints), 2);
const instrumentsOf = (rows: InstrumentsBody) =>
  rows.map((row) => ({
    asset:
      "assetId" in row
        ? { id: row.assetId }
        : { instrument: { instrumentId: row.instrumentId, mic: row.mic } },
    weightBp: weightBp(row.weight),
  }));
const cents2 = (value: bigint | null) => (value === null ? null : centsToDecimal(value));

/** A numeric column, as the contract writes it: "2.5", never "2.500000000000". */
const plain = (value: string | null, scale: number) =>
  value === null ? null : formatDecimal(parseDecimal(value, scale), scale);

/** A fee's rate is a percentage on the wire, as the funds' ("0.19" is 0,19 %), a fraction in the domain. */
const feeOf = (fee: FeeBody) => ({
  feeCents: fee === null ? null : cents(fee.amount),
  feeRate: fee?.rate == null ? null : decimal(percentToFraction(fee.rate), RATE_SCALE),
});
const percentOf = (fraction: string | null) =>
  fraction === null ? null : formatDecimal(parseDecimal(fraction, RATE_SCALE) * 100n, RATE_SCALE);

type Proposal = NonNullable<RunView["proposal"]>;
const proposalOut = (proposal: Proposal | null) =>
  proposal === null
    ? null
    : {
        on: proposal.on,
        quantity: formatDecimal(proposal.quantity, QUANTITY_SCALE),
        unitPrice: formatDecimal(proposal.unitPrice, PRICE_SCALE),
        amount: centsToDecimal(proposal.spentCents),
        fee: centsToDecimal(proposal.feeCents),
      };

function planOut(view: PlanView) {
  const { plan, asset, nextDueOn, toConfirm, waitingPrice } = view;
  const noFee = plan.feeCents === null && plan.feeRate === null;
  const basket = plan.model === "basket";
  return {
    id: plan.id,
    name: plan.name,
    asset: { id: asset.id, name: asset.name, instrumentId: asset.instrumentId, mic: asset.mic },
    currency: view.currency,
    amount: maybe(basket ? plan.executionAmountCents : plan.amountCents),
    quantity: plain(plan.quantity, QUANTITY_SCALE),
    fractions: plan.fractions,
    frequency: plan.frequency,
    interval: plan.interval,
    day: plan.day,
    startOn: plan.startOn,
    endOn: plan.endOn,
    runsLimit: plan.runsLimit,
    debitAccountId: plan.debitAccountId,
    fee: noFee ? null : { amount: maybe(plan.feeCents), rate: percentOf(plan.feeRate) },
    mode: plan.mode,
    state: plan.state,
    nextDueOn,
    toConfirm,
    waitingPrice,
    model: plan.model,
    instruments: [...view.instruments]
      .sort((left, right) => right.weightBp - left.weightBp)
      .map((one) => ({
        assetId: one.id,
        name: one.name,
        instrumentId: one.instrumentId,
        mic: one.mic,
        weight: weightOut(one.weightBp),
      })),
    carry: centsToDecimal(view.carryCents),
  };
}

type Line = RunView["lines"][number];
const lineOut = (line: Line) => ({
  assetId: line.assetId,
  name: line.name,
  weight: weightOut(line.weightBp),
  price: plain(line.price, PRICE_SCALE),
  priceCurrency: line.priceCurrency,
  priceOn: line.priceOn,
  fxRate: plain(line.fxRate, RATE_SCALE),
  target: centsToDecimal(line.targetCents),
  quantity: plain(line.quantity, QUANTITY_SCALE) ?? "0",
  spent: centsToDecimal(line.spentCents),
  state: line.state,
  eventId: line.eventId,
});

const previewLineOut = (line: PreviewLine, name: string) => ({
  assetId: line.assetId,
  name,
  weight: weightOut(line.weightBp),
  price: line.unitPrice === null ? null : formatDecimal(line.unitPrice, PRICE_SCALE),
  fxRate: line.rate === null ? null : formatDecimal(line.rate, RATE_SCALE),
  target: centsToDecimal(line.targetCents),
  quantity: formatDecimal(line.quantity, QUANTITY_SCALE),
  spent: centsToDecimal(line.spentCents),
  state: line.state,
});

function runOut({ run, currency, proposal, eventId, debit, lines }: RunView) {
  return {
    id: run.id,
    dueOn: run.dueOn,
    state: run.state,
    currency,
    price: plain(run.price, PRICE_SCALE),
    priceOn: run.priceOn,
    waitingSince: run.waitingSince,
    reason: run.reason,
    proposal: proposalOut(proposal),
    debit:
      debit === null
        ? null
        : {
            transactionId: debit.transactionId,
            on: debit.on,
            amount: centsToDecimal(debit.cents),
            currency: debit.currency,
            payee: debit.payee,
            linked: debit.linked,
          },
    eventId,
    automatic: run.recordedBy === "job",
    budget: cents2(run.budgetCents),
    carryIn: cents2(run.carryInCents),
    carryOut: cents2(run.carryOutCents),
    lines: lines.map(lineOut),
  };
}

function pastRunsOut(planId: string, past: PastRuns) {
  return {
    planId,
    currency: past.currency,
    runs: past.runs.map((run) => ({
      dueOn: run.dueOn,
      price: run.price === null ? null : formatDecimal(run.price.unitPrice, PRICE_SCALE),
      priceOn: run.price?.on ?? null,
      proposal: proposalOut(run.proposal),
    })),
    more: past.more,
  };
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, plans.createPlan, async ({ ctx, params, body }) => {
    const { amount, instruments, fee, ...schedule } = body;
    return refusing(() =>
      createBasketPlan(ctx, params.accountId, {
        ...schedule,
        amountCents: cents(amount) ?? 0n,
        instruments: instrumentsOf(instruments),
        ...feeOf(fee),
      }),
    );
  });
  serve(app, guard, plans.updatePlan, async ({ ctx, params, body }) => {
    const { fee, amount, instruments, ...rest } = body;
    await refusing(() =>
      updatePlan(ctx, params.accountId, params.planId, {
        ...rest,
        ...(fee === undefined ? {} : feeOf(fee)),
        ...(amount === undefined ? {} : { amountCents: cents(amount) ?? 0n }),
        ...(instruments === undefined ? {} : { instruments: instrumentsOf(instruments) }),
      }),
    );
  });
  serve(app, guard, plans.listPastRuns, async ({ ctx, params }) =>
    pastRunsOut(params.planId, await refusing(() => listPastRuns(ctx, params.accountId, params.planId))),
  );
  serve(app, guard, plans.backfillPlan, async ({ ctx, params, body }) => {
    const { eventIds } = await refusing(() =>
      backfillPlan(ctx, params, {
        runs: body.runs.map((run) => ({
          dueOn: run.dueOn,
          on: run.on,
          quantity: parseDecimal(run.quantity, QUANTITY_SCALE),
          unitPrice: parseDecimal(run.unitPrice, PRICE_SCALE),
          feeCents: cents(run.fee),
        })),
      }),
    );
    return { ids: eventIds };
  });
}

function serveRuns(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, plans.listPlanRuns, async ({ ctx, params }) => ({
    planId: params.planId,
    runs: (await refusing(() => listRuns(ctx, params.accountId, params.planId))).map(runOut),
  }));
  serve(app, guard, plans.previewPlanRun, async ({ ctx, params, body }) => {
    const preview = await refusing(() =>
      previewRun(ctx, params, {
        lines: body.lines.map((line) => ({
          assetId: line.assetId,
          unitPrice: decimal(line.unitPrice ?? null, PRICE_SCALE) ?? undefined,
          quantity: decimal(line.quantity ?? null, QUANTITY_SCALE) ?? undefined,
        })),
      }),
    );
    return {
      runId: preview.run.id,
      currency: preview.currency,
      budget: centsToDecimal(preview.run.budgetCents ?? 0n),
      spent: centsToDecimal(preview.spentCents),
      carryOut: centsToDecimal(preview.carryOutCents),
      lines: preview.lines.map((line) => previewLineOut(line, preview.names.get(line.assetId) ?? "")),
    };
  });
  serve(app, guard, plans.confirmPlanRun, async ({ ctx, params, body }) => {
    if (body.lines !== undefined) {
      const { eventIds } = await refusing(() =>
        confirmBasketRun(ctx, params, {
          on: body.on,
          lines: (body.lines ?? []).map((line) => ({
            assetId: line.assetId,
            quantity: parseDecimal(line.quantity, QUANTITY_SCALE),
            unitPrice: decimal(line.unitPrice ?? null, PRICE_SCALE) ?? undefined,
            feeCents: cents(line.fee ?? null) ?? undefined,
          })),
        }),
      );
      return { id: eventIds[0], ids: eventIds };
    }
    const { eventId } = await refusing(() =>
      confirmRun(ctx, params, {
        on: body.on,
        quantity: decimal(body.quantity ?? null, QUANTITY_SCALE) ?? undefined,
        unitPrice: decimal(body.unitPrice ?? null, PRICE_SCALE) ?? undefined,
        feeCents: cents(body.fee ?? null) ?? undefined,
      }),
    );
    return { id: eventId, ids: [eventId] };
  });
  serve(app, guard, plans.linkPlanRunDebit, async ({ ctx, params }) => {
    await refusing(() => linkRunDebit(ctx, params.accountId, params.planId, params.runId));
  });
  serve(app, guard, plans.skipPlanRun, async ({ ctx, params }) => {
    await refusing(() => skipRun(ctx, params));
  });
}

export function servePlans(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, plans.listPlans, async ({ ctx, params }) => ({
    accountId: params.accountId,
    plans: (await refusing(() => listPlans(ctx, params.accountId))).map(planOut),
  }));
  serveWrites(app, guard);
  serveRuns(app, guard);
}
