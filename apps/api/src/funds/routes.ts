// Funds (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the domain's
// use cases, the ones the Server Actions call. The bodies arrive in canonical form (amounts "1234.56",
// a fee's rate a percentage) and become the domain's cents and fractions here, nowhere else. Hono
// tries the routes in order: `/funds/{id}/sources/restore` comes before `/funds/{id}/sources/{sourceId}`.
import type { Hono } from "hono";
import type { z } from "zod";
import { FUNDS, FUNDS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import {
  acceptDifference,
  addContribution,
  addFee,
  addSource,
  clearDecision,
  competencesFromPayslips,
  createFund,
  deleteContribution,
  deleteValuation,
  FundError,
  movementCandidates,
  fundContributionsView,
  fundOverviewView,
  fundSettingsView,
  fundSetupView,
  fundsHomeView,
  fundValuationsView,
  proposeDebitMatch,
  recordValuation,
  removeFee,
  removeSource,
  replaceCompetences,
  restoreSource,
  setFundState,
  setSourceState,
  updateContribution,
  updateFee,
  updateFund,
  updateSource,
  updateValuation,
  viewPeriod,
} from "@ledgerly/domain/funds";
import { appliedPayslips } from "@ledgerly/domain/payroll";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { today } from "@ledgerly/domain/shared/dates";
import { centsToDecimal, parseCents, percentToFraction } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import {
  candidatesOut,
  contributionsOut,
  feeOut,
  homeOut,
  overviewOut,
  settingsOut,
  setupOut,
  sourceOut,
  valuationsOut,
} from "./dto";

const { funds, register, setup } = FUNDS;

const INVALID = new Set(["invalid", "invalid_account", "future_date", "before_start"]);

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof FundError) {
      if (error.code === "not_found") throw new ApiRefusal("not_found");
      if (INVALID.has(error.code)) throw new ApiRefusal("invalid", error.code);
      throw new ApiRefusal("conflict", error.code, error.detail ?? undefined);
    }
    if (error instanceof RangeError) throw new ApiRefusal("invalid", "invalid");
    if (error instanceof Error && error.name === "ZodError") throw new ApiRefusal("invalid", "invalid");
    throw error;
  }
}

const cents = (amount: string) => parseCents(amount);
const centsOrNull = (amount: string | null) => (amount === null ? null : parseCents(amount));

type SourceBody = z.output<typeof setup.addSource.body>;
type FeeBody = z.output<typeof setup.updateFee.body>;
type OperationBody = z.output<typeof register.addOperation.body>;

/** A source as the domain takes it. */
function sourceInput(body: SourceBody) {
  if (body.kind === "bank_debit") {
    const { amount, ...rest } = body;
    return { ...rest, amountCents: cents(amount) };
  }
  return body;
}

/** A fee as the domain takes it: cents, and the rate as a fraction. */
function feeInput(body: FeeBody) {
  const { amount, rate, ...rest } = body;
  return { ...rest, amountCents: centsOrNull(amount), rate: rate === null ? null : percentToFraction(rate) };
}

/** An operation as the domain takes it. */
function operationInput(body: OperationBody) {
  const common = { on: body.on, note: body.note, feeCents: centsOrNull(body.fee) };
  if (body.kind === "voluntary") {
    return { ...common, kind: body.kind, amountCents: cents(body.amount), transactionId: body.transactionId };
  }
  if (body.kind === "payroll") {
    return {
      ...common,
      kind: body.kind,
      workerCents: cents(body.worker),
      employerCents: cents(body.employer),
      tfrCents: cents(body.tfr),
      period: body.competence,
    };
  }
  return {
    ...common,
    kind: body.kind,
    classification: body.classification,
    amountCents: cents(body.amount),
    period: body.competence,
  };
}

/** Every applied payslip's competence, published for a fund the payslip feeds (as the action does). */
async function publish(ctx: Ctx, fundId: string): Promise<number> {
  return replaceCompetences(ctx, fundId, competencesFromPayslips(await appliedPayslips(ctx)));
}

const periodOf = (ctx: Ctx, query: { period?: string; from?: string; to?: string }) =>
  refusing(async () => viewPeriod(query, today(ctx.timeZone)));

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, funds.getFunds, async ({ ctx, query }) =>
    homeOut(await fundsHomeView(ctx, await periodOf(ctx, query))),
  );
  // Before `/funds/{id}`: Hono tries the routes in order.
  serve(app, guard, funds.getFundSetup, async ({ ctx }) => setupOut(await fundSetupView(ctx)));
  serve(app, guard, funds.getFund, async ({ ctx, params, query }) =>
    overviewOut(await refusing(async () => fundOverviewView(ctx, params.id, await periodOf(ctx, query)))),
  );
  serve(app, guard, funds.getFundValuations, async ({ ctx, params, query }) =>
    valuationsOut(await refusing(async () => fundValuationsView(ctx, params.id, await periodOf(ctx, query)))),
  );
  serve(app, guard, funds.getFundContributions, async ({ ctx, params, query }) =>
    contributionsOut(
      await refusing(async () => fundContributionsView(ctx, params.id, await periodOf(ctx, query))),
    ),
  );
  serve(app, guard, funds.getFundSettings, async ({ ctx, params }) =>
    settingsOut(await refusing(() => fundSettingsView(ctx, params.id))),
  );
  serve(app, guard, funds.getFundMovementCandidates, async ({ ctx, params, query }) =>
    candidatesOut(await refusing(() => movementCandidates(ctx, params.id, query.accountId ?? null))),
  );
  serve(app, guard, setup.debitMatch, async ({ ctx, params, query }) => {
    const found = await refusing(() =>
      proposeDebitMatch(ctx, params.id, query.transactionId, query.accountId ?? null),
    );
    if (found === null) return { found: null };
    return {
      found: {
        kind: found.key.kind,
        text: found.key.text,
        count: found.charges.length,
        first: found.first,
        last: found.last,
        median: found.medianCents === null ? null : centsToDecimal(found.medianCents),
        intervalDays: found.intervalDays,
      },
    };
  });
}

function serveFund(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, funds.createFund, async ({ ctx, body }) =>
    refusing(async () => {
      const fund = await createFund(ctx, {
        fund: body.fund,
        currency: body.currency,
        value: body.value === null ? null : { on: body.value.on, cents: cents(body.value.value) },
        sources: body.sources.map(sourceInput),
        fees: body.fees.map(({ source, ...fee }) => {
          const { label, basis, amountCents, rate, period, component, validFrom, validTo, note } = feeInput({
            ...fee,
            sourceId: null,
          });
          return {
            label,
            basis,
            amountCents,
            rate,
            period,
            component,
            validFrom,
            validTo,
            note,
            sourceIndex: source,
          };
        }),
      });
      const published = body.sources.some((one) => one.kind === "payroll") ? await publish(ctx, fund.id) : 0;
      return { id: fund.id, published };
    }),
  );
  serve(app, guard, funds.updateFund, async ({ ctx, params, body }) => {
    await refusing(() => updateFund(ctx, params.id, body));
  });
  serve(app, guard, funds.setFundState, async ({ ctx, params, body }) => {
    await refusing(() => setFundState(ctx, params.id, body.state));
  });
}

function serveRegister(app: Hono<ApiEnv>, guard: Guard): void {
  const valuation = (body: { on: string; value: string; note: string | null }) => ({
    on: body.on,
    cents: cents(body.value),
    units: null,
    note: body.note,
  });
  serve(app, guard, register.recordValuation, async ({ ctx, params, body }) => {
    const row = await refusing(() => recordValuation(ctx, params.id, valuation(body)));
    return { id: row.id };
  });
  serve(app, guard, register.updateValuation, async ({ ctx, params, body }) => {
    await refusing(() => updateValuation(ctx, params.valuationId, valuation(body)));
  });
  serve(app, guard, register.deleteValuation, async ({ ctx, params }) => {
    await refusing(() => deleteValuation(ctx, params.valuationId));
  });
  serve(app, guard, register.addOperation, async ({ ctx, params, body }) => {
    const row = await refusing(() => addContribution(ctx, params.id, operationInput(body)));
    return { id: row.id };
  });
  serve(app, guard, register.updateOperation, async ({ ctx, params, body }) => {
    await refusing(() => updateContribution(ctx, params.operationId, operationInput(body)));
  });
  serve(app, guard, register.deleteOperation, async ({ ctx, params }) => {
    await refusing(() => deleteContribution(ctx, params.operationId));
  });
  serve(app, guard, register.decideDifference, async ({ ctx, params, body }) => {
    await refusing(() =>
      acceptDifference(ctx, params.id, {
        year: params.year,
        quarter: params.index,
        component: params.component,
        note: body.note,
      }),
    );
  });
  serve(app, guard, register.clearDecision, async ({ ctx, params }) => {
    await refusing(() => clearDecision(ctx, params.id, params.year, params.index, params.component));
  });
}

function serveSetup(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, setup.addSource, async ({ ctx, params, body }) =>
    refusing(async () => {
      const source = await addSource(ctx, params.id, sourceInput(body));
      return { id: source.id, published: body.kind === "payroll" ? await publish(ctx, params.id) : 0 };
    }),
  );
  serve(app, guard, setup.updateSource, async ({ ctx, params, body }) =>
    refusing(async () => {
      const source = await updateSource(ctx, params.sourceId, sourceInput(body));
      return { id: source.id, published: body.kind === "payroll" ? await publish(ctx, params.id) : 0 };
    }),
  );
  serve(app, guard, setup.setSourceState, async ({ ctx, params, body }) => {
    await refusing(() => setSourceState(ctx, params.sourceId, body.state));
  });
  serve(app, guard, setup.restoreSource, async ({ ctx, params, body }) => {
    const { source, fees } = body;
    await refusing(() =>
      restoreSource(ctx, params.id, {
        source: { ...restoredSource(source), id: source.id, state: source.state },
        dueEntries: source.dueEntries,
        fees: fees.map(({ id, ...fee }) => ({ ...feeInput(fee), id })),
      }),
    );
  });
  serve(app, guard, setup.removeSource, async ({ ctx, params }) => {
    const removed = await refusing(() => removeSource(ctx, params.sourceId));
    return { source: sourceOut(removed.source, null, 0), fees: removed.fees.map(feeOut) };
  });
  serve(app, guard, setup.addFee, async ({ ctx, params, body }) => {
    const { id, ...fee } = body;
    const row = await refusing(() => addFee(ctx, params.id, { ...feeInput(fee), ...(id ? { id } : {}) }));
    return { id: row.id };
  });
  serve(app, guard, setup.updateFee, async ({ ctx, params, body }) => {
    await refusing(() => updateFee(ctx, params.feeId, feeInput(body)));
  });
  serve(app, guard, setup.removeFee, async ({ ctx, params }) => {
    await refusing(() => removeFee(ctx, params.feeId));
  });
  serve(app, guard, setup.rebuildCompetences, async ({ ctx, params }) => ({
    published: await refusing(() => publish(ctx, params.id)),
  }));
}

type RemovedSource = z.output<typeof setup.restoreSource.body>["source"];

/** A removed source, as the domain takes it back: the fields of its kind, its due dates kept. */
function restoredSource(source: RemovedSource) {
  if (source.kind === "payroll") {
    return {
      kind: "payroll" as const,
      components: source.components ?? [],
      accrualPeriod: source.accrualPeriod ?? "quarter",
      employer: source.employer,
      due: source.due,
      toleranceDays: source.toleranceDays ?? undefined,
      note: source.note,
      keepDueEntries: source.dueEntries !== null,
    };
  }
  if (source.kind === "bank_debit") {
    return {
      kind: "bank_debit" as const,
      amountCents: centsOrNull(source.amount) ?? 0n,
      frequency: source.frequency ?? { count: 1, unit: "month" as const },
      debitDay: source.debitDay,
      accountId: source.accountId,
      payeeMatch: source.payeeMatch ?? "",
      validFrom: source.validFrom,
      validTo: source.validTo,
    };
  }
  return { kind: "manual" as const };
}

/** Every route of funds. */
export function serveFunds(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serveReads(app, guard);
  serveFund(app, guard);
  serveRegister(app, guard);
  serveSetup(app, guard);
  return FUNDS_ROUTES;
}
