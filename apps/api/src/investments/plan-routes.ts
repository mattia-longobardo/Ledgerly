// Investments · the routes of the purchase plans (rewrite plan R5d, step 2; 11-standardization.md
// §11.3): the plans of a manual portfolio, their instalments, a confirmation, a skip, the past
// instalments and the link to the bank movement. Canonical numbers in, the domain's fixed point out.
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS } from "@ledgerly/api-contract";
import {
  backfillPlan,
  confirmRun,
  createPlan,
  linkRunDebit,
  listPastRuns,
  listPlans,
  listRuns,
  type PastRuns,
  type PlanView,
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

function planOut({ plan, asset, nextDueOn, toConfirm, waitingPrice }: PlanView) {
  const noFee = plan.feeCents === null && plan.feeRate === null;
  return {
    id: plan.id,
    name: plan.name,
    asset: { id: asset.id, name: asset.name, instrumentId: asset.instrumentId, mic: asset.mic },
    currency: asset.currency,
    amount: maybe(plan.amountCents),
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
  };
}

function runOut({ run, currency, proposal, eventId, debit }: RunView) {
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
    const { instrumentId, mic, amount, quantity, fee, ...schedule } = body;
    return refusing(() =>
      createPlan(ctx, params.accountId, {
        ...schedule,
        instrument: { instrumentId, mic },
        amountCents: cents(amount),
        quantity: decimal(quantity, QUANTITY_SCALE),
        ...feeOf(fee),
      }),
    );
  });
  serve(app, guard, plans.updatePlan, async ({ ctx, params, body }) => {
    const { fee, ...rest } = body;
    await refusing(() =>
      updatePlan(ctx, params.accountId, params.planId, { ...rest, ...(fee === undefined ? {} : feeOf(fee)) }),
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
  serve(app, guard, plans.confirmPlanRun, async ({ ctx, params, body }) => {
    const { eventId } = await refusing(() =>
      confirmRun(ctx, params, {
        on: body.on,
        quantity: decimal(body.quantity ?? null, QUANTITY_SCALE) ?? undefined,
        unitPrice: decimal(body.unitPrice ?? null, PRICE_SCALE) ?? undefined,
        feeCents: cents(body.fee ?? null) ?? undefined,
      }),
    );
    return { id: eventId };
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
