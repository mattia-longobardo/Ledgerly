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
  listPlans,
  listRuns,
  type PlanView,
  PRICE_SCALE,
  QUANTITY_SCALE,
  RATE_SCALE,
  type RunView,
  skipRun,
  updatePlan,
} from "@ledgerly/domain/investments";
import { centsToDecimal, formatDecimal, parseCents, parseDecimal } from "@ledgerly/domain/shared/money";
import { type ApiEnv, type Guard, serve } from "../serve";
import { maybe } from "./dto";
import { cents, decimal, refusing } from "./refusals";

const { plans } = INVESTMENTS;

type FeeBody = z.output<typeof plans.createPlan.body>["fee"];

/** A numeric column, as the contract writes it: "2.5", never "2.500000000000". */
const plain = (value: string | null, scale: number) =>
  value === null ? null : formatDecimal(parseDecimal(value, scale), scale);

const feeOf = (fee: FeeBody) => ({
  feeCents: fee === null ? null : cents(fee.amount),
  feeRate: fee === null ? null : decimal(fee.rate, RATE_SCALE),
});

function planOut({ plan, asset, nextDueOn, toConfirm, waitingPrice }: PlanView) {
  const noFee = plan.feeCents === null && plan.feeRate === null;
  return {
    id: plan.id,
    name: plan.name,
    asset,
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
    fee: noFee ? null : { amount: maybe(plan.feeCents), rate: plain(plan.feeRate, RATE_SCALE) },
    mode: plan.mode,
    state: plan.state,
    nextDueOn,
    toConfirm,
    waitingPrice,
  };
}

function runOut({ run, proposal, eventId, debit }: RunView) {
  return {
    id: run.id,
    dueOn: run.dueOn,
    state: run.state,
    price: plain(run.price, PRICE_SCALE),
    priceOn: run.priceOn,
    waitingSince: run.waitingSince,
    reason: run.reason,
    proposal:
      proposal === null
        ? null
        : {
            on: proposal.on,
            quantity: formatDecimal(proposal.quantity, QUANTITY_SCALE),
            unitPrice: formatDecimal(proposal.unitPrice, PRICE_SCALE),
            amount: centsToDecimal(proposal.spentCents),
            fee: centsToDecimal(proposal.feeCents),
          },
    debit:
      debit === null
        ? null
        : {
            transactionId: debit.transactionId,
            on: debit.on,
            amount: centsToDecimal(debit.cents),
            payee: debit.payee,
            linked: debit.linked,
          },
    eventId,
    automatic: run.recordedBy === "job",
  };
}

function serveWrites(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, plans.createPlan, async ({ ctx, params, body }) =>
    refusing(() =>
      createPlan(ctx, params.accountId, {
        name: body.name,
        instrument: { instrumentId: body.instrumentId, mic: body.mic },
        amountCents: cents(body.amount),
        quantity: decimal(body.quantity, QUANTITY_SCALE),
        fractions: body.fractions,
        frequency: body.frequency,
        interval: body.interval,
        day: body.day,
        startOn: body.startOn,
        endOn: body.endOn,
        runsLimit: body.runsLimit,
        debitAccountId: body.debitAccountId,
        ...feeOf(body.fee),
        mode: body.mode,
      }),
    ),
  );
  serve(app, guard, plans.updatePlan, async ({ ctx, params, body }) => {
    const { fee, ...rest } = body;
    await refusing(() =>
      updatePlan(ctx, params.accountId, params.planId, { ...rest, ...(fee === undefined ? {} : feeOf(fee)) }),
    );
  });
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
        quantity: body.quantity === undefined ? undefined : parseDecimal(body.quantity, QUANTITY_SCALE),
        unitPrice: body.unitPrice === undefined ? undefined : parseDecimal(body.unitPrice, PRICE_SCALE),
        feeCents: body.fee === undefined ? undefined : parseCents(body.fee),
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
