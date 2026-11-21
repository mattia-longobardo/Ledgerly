// Investments (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's use cases, the ones the pages and the Server Actions call. The bodies arrive in canonical
// form (amounts "1234.56", quantities and prices plain decimals) and become the domain's cents and
// fixed-point decimals here, nowhere else. Hono tries the routes in order: `/investments/home`,
// `/catalog` and `/connections` come before `/investments/{accountId}`.
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS, INVESTMENTS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import { AccountError } from "@ledgerly/domain/accounts";
import {
  catalogView,
  checkSyncNow,
  confirmKeyRevoked,
  confirmZeroReading,
  connectInvestmentProvider,
  createManualService,
  deleteOperation,
  disconnectProvider,
  InvestmentError,
  investmentsHome,
  investmentsPnl,
  investmentsPnlView,
  investmentsPortfolio,
  investmentsSnapshot,
  type InvestmentsSnapshot,
  linkTransfer,
  type PeriodParams,
  PRICE_SCALE,
  QUANTITY_SCALE,
  reconcileHolding,
  recordOperation,
  replaceKey,
  serviceActivity,
  serviceDetail,
  serviceHoldings,
  serviceMovements,
  servicePnlView,
  servicePositions,
  SyncError,
  unlinkTransfer,
  updateServiceUrl,
  updateServiceValue,
  verifyKey,
} from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { today } from "@ledgerly/domain/shared/dates";
import { parseCents, parseDecimal } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { holdingsOut, listOut } from "./dto";
import { activityOut, homeOut, movementsOut, overviewOut } from "./pages";
import { catalogOut, connectionOut, positionsOut } from "./tabs";

const { investments, register, connection } = INVESTMENTS;

/**
 * What the web process lends the routes until R4: the queue of its worker. «Sync now» and a new
 * connection put their pass in it, as the Server Actions do (`tasks` of `platform/jobs/queue`).
 */
export interface InvestmentCases {
  /** A pass of the connection, now (`tasks.updateConnection`). */
  queueSync(ctx: Ctx, connectionId: string): Promise<void>;
  /** The first flows of a new connection, read after the answer (`tasks.firstFlows`). */
  queueFirstFlows(ctx: Ctx, connectionId: string, accountId: string): Promise<void>;
}

/** The refusals of the caller's input (`INVESTMENT_REFUSALS`): every other one is a conflict. */
const INVALID = new Set([
  "future_date",
  "before_period",
  "invalid_transaction",
  "unknown_provider",
  "invalid_credentials",
  "unsupported_currency",
  "invalid",
]);

/** A missing service, with the words the MCP tool `get_investment_holdings` has always said. */
function notFound(): ApiRefusal {
  const refusal = new ApiRefusal("not_found");
  refusal.message = "Investment service not found.";
  return refusal;
}

/** Runs a use case of the module and turns its refusal into the contract's. */
async function refusing<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof InvestmentError || error instanceof SyncError || error instanceof AccountError) {
      if (error.code === "not_found") throw notFound();
      if (INVALID.has(error.code))
        throw new ApiRefusal("invalid", error.code === "invalid" ? undefined : error.code);
      throw new ApiRefusal("conflict", error.code);
    }
    if (error instanceof RangeError) throw new ApiRefusal("invalid");
    if (error instanceof Error && error.name === "ZodError") throw new ApiRefusal("invalid");
    throw error;
  }
}

const found = <T>(value: T | null): T => {
  if (value === null) throw notFound();
  return value;
};

const decimal = (value: string | null, scale: number) => (value === null ? null : parseDecimal(value, scale));
const cents = (value: string | null) => (value === null ? null : parseCents(value));

/**
 * The period of the pages' reads (`period` = `all` | a year | `custom` with `from` and `to`; none is
 * the year running), checked, as the engine takes it (`periodOf`). A year to come, or days that are
 * no period, are `invalid`: the page sends such an address back to the year running instead.
 */
function periodOf(ctx: Ctx, query: { period?: string; from?: string; to?: string }): PeriodParams {
  const { period, from, to } = query;
  const todayOn = today(ctx.timeZone);
  if (period === "custom") {
    if (!from || !to || from > to || from > todayOn) throw new ApiRefusal("invalid");
    return { from, to };
  }
  const year = Number(period ?? todayOn.slice(0, 4));
  if (period !== "all" && (year < 1970 || year > Number(todayOn.slice(0, 4))))
    throw new ApiRefusal("invalid");
  return { period: period ?? null };
}

/** A service's detail and one view of its period, from one read of its book (INV-4). */
async function withDetail<T>(
  ctx: Ctx,
  accountId: string,
  read: (snapshot: InvestmentsSnapshot) => Promise<T | null>,
) {
  const snapshot = await investmentsSnapshot(ctx, { accountId });
  const [detail, view] = await Promise.all([serviceDetail(ctx, accountId, snapshot), read(snapshot)]);
  if (!detail || !view) throw notFound();
  return { detail, view };
}

function serveReads(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, investments.listInvestments, async ({ ctx, query }) => {
    // The legacy query: a value it cannot read is the year running, never a 400 (`periodOf`).
    const params = { period: query.period ?? null, from: query.from ?? null, to: query.to ?? null };
    // One read of the books for both (INV-4).
    const snapshot = await investmentsSnapshot(ctx);
    const [portfolio, pnl] = await Promise.all([
      investmentsPortfolio(ctx, snapshot),
      investmentsPnl(ctx, params, snapshot),
    ]);
    return listOut(portfolio, pnl);
  });
  // The literal paths first: `/investments/{accountId}` would take them.
  serve(app, guard, investments.getInvestmentsHome, async ({ ctx, query }) => {
    const period = periodOf(ctx, query);
    const snapshot = await investmentsSnapshot(ctx);
    const [home, pnl] = await Promise.all([
      investmentsHome(ctx, snapshot),
      investmentsPnlView(ctx, period, snapshot),
    ]);
    return homeOut(home, pnl);
  });
  serve(app, guard, investments.getInvestmentsCatalog, async ({ ctx }) => catalogOut(await catalogView(ctx)));
  serve(app, guard, investments.getInvestmentHoldings, async ({ ctx, params }) =>
    holdingsOut(found(await serviceHoldings(ctx, params.accountId))),
  );
  serve(app, guard, investments.getInvestment, async ({ ctx, params, query }) => {
    const period = periodOf(ctx, query);
    const { detail, view: pnl } = await withDetail(ctx, params.accountId, (snapshot) =>
      servicePnlView(ctx, params.accountId, period, snapshot),
    );
    const activity = await serviceActivity(ctx, params.accountId, {
      ...pnl.span,
      family: null,
      q: null,
      assetId: null,
      page: 1,
    });
    return overviewOut(detail, pnl, activity);
  });
}

/** The tabs of a service: Activity, Positions and Connection (the session's only). */
function serveTabs(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, investments.getInvestmentActivity, async ({ ctx, params, query }) => {
    const period = periodOf(ctx, query);
    const { detail, view: pnl } = await withDetail(ctx, params.accountId, (snapshot) =>
      servicePnlView(ctx, params.accountId, period, snapshot),
    );
    // A manual service counts its account's movements (PERS-342): they are its activity.
    if (detail.summary.investment.provider === "manual") {
      return movementsOut(pnl, found(await serviceMovements(ctx, params.accountId, pnl.span)));
    }
    const known = detail.assets.some((asset) => asset.id === query.assetId);
    const activity = await serviceActivity(ctx, params.accountId, {
      ...pnl.span,
      family: query.family ?? null,
      q: query.q?.trim() || null,
      assetId: known ? query.assetId! : null,
      page: query.page ?? 1,
    });
    return activityOut(detail, pnl, found(activity));
  });
  serve(app, guard, investments.getInvestmentPositions, async ({ ctx, params, query }) => {
    const period = periodOf(ctx, query);
    const { detail, view } = await withDetail(ctx, params.accountId, (snapshot) =>
      servicePositions(ctx, params.accountId, period, snapshot),
    );
    return positionsOut(detail, view);
  });
  serve(app, guard, investments.getInvestmentConnection, async ({ ctx, params }) => {
    const detail = found(await serviceDetail(ctx, params.accountId));
    const sync = detail.sync;
    const connected = sync?.connected
      ? ((await listConnections(ctx)).find((one) => one.provider === sync.provider) ?? null)
      : null;
    return connectionOut(detail, today(ctx.timeZone), connected?.id ?? null, ctx.timeZone);
  });
}

type OperationBody = z.output<typeof register.recordOperation.body>;

/**
 * What a person may no longer write (PERS-342): money in and out, the value and a correction come
 * from Accounts on a manual service and from the provider on a synced one — as the Server Action.
 */
const VALUE_KINDS = new Set(["deposit", "withdrawal", "account_valuation", "adjustment"]);

/** An operation as the domain takes it: a price wins over an amount, as the form's (`operationOf`). */
function operationInput(body: OperationBody) {
  switch (body.kind) {
    case "valuation": {
      const unitPrice = decimal(body.unitPrice, PRICE_SCALE);
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        unitPrice,
        amountCents: unitPrice === null ? cents(body.amount) : null,
        note: body.note,
      };
    }
    case "sell":
    case "close": {
      const quantity = decimal(body.quantity, QUANTITY_SCALE);
      const unitPrice = decimal(body.unitPrice, PRICE_SCALE);
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        quantity,
        unitPrice: quantity === null ? null : unitPrice,
        amountCents: quantity === null || unitPrice === null ? cents(body.amount) : null,
        feeCents: cents(body.fee) ?? 0n,
        note: body.note,
      };
    }
    case "income":
      return {
        kind: body.kind,
        holdingId: body.holdingId,
        on: body.on,
        amountCents: parseCents(body.amount),
        note: body.note,
      };
    default:
      throw new ApiRefusal("conflict", "not_editable");
  }
}

function serveRegister(app: Hono<ApiEnv>, guard: Guard): void {
  serve(app, guard, register.createManualService, async ({ ctx, body }) =>
    refusing(() => createManualService(ctx, body)),
  );
  serve(app, guard, register.updateServiceUrl, async ({ ctx, params, body }) => {
    await refusing(() => updateServiceUrl(ctx, params.accountId, body.url));
  });
  serve(app, guard, register.updateServiceValue, async ({ ctx, params, body }) => {
    await refusing(async () =>
      updateServiceValue(ctx, params.accountId, { on: body.on, cents: parseCents(body.amount) }),
    );
  });
  serve(app, guard, register.recordOperation, async ({ ctx, params, body }) => {
    if (VALUE_KINDS.has(body.kind)) throw new ApiRefusal("conflict", "not_editable");
    const { eventId } = await refusing(async () =>
      recordOperation(ctx, params.accountId, operationInput(body)),
    );
    return { id: eventId };
  });
  serve(app, guard, register.deleteOperation, async ({ ctx, params }) => {
    await refusing(() => deleteOperation(ctx, params.eventId, params.accountId));
  });
  serve(app, guard, register.reconcileHolding, async ({ ctx, params, body }) => {
    await refusing(async () =>
      reconcileHolding(
        ctx,
        {
          holdingId: params.holdingId,
          kind: body.kind,
          effectiveOn: body.effectiveOn,
          quantity: body.kind === "partial" ? decimal(body.quantity, QUANTITY_SCALE) : null,
          product: body.kind === "outside_scope" ? body.product : null,
          readingId: body.readingId,
        },
        params.accountId,
      ),
    );
  });
  serve(app, guard, register.confirmZero, async ({ ctx, params }) => {
    await refusing(() => confirmZeroReading(ctx, params.readingId, params.accountId));
  });
  serve(app, guard, register.linkTransfer, async ({ ctx, body }) => ({
    id: await refusing(() => linkTransfer(ctx, body)),
  }));
  serve(app, guard, register.unlinkTransfer, async ({ ctx, params }) => {
    await refusing(() => unlinkTransfer(ctx, params.eventId, params.accountId));
  });
}

function serveConnection(app: Hono<ApiEnv>, guard: Guard, cases: InvestmentCases): void {
  serve(app, guard, connection.connectProvider, async ({ ctx, body }) =>
    refusing(() =>
      connectInvestmentProvider(
        ctx,
        body.provider,
        body.credentials,
        body.target,
        new Date(),
        (id, accountId) => cases.queueFirstFlows(ctx, id, accountId),
      ),
    ),
  );
  serve(app, guard, connection.syncNow, async ({ ctx, params }) => {
    const { connection: linked } = await refusing(() => checkSyncNow(ctx, params.accountId));
    await cases.queueSync(ctx, linked.id);
  });
  serve(app, guard, connection.checkKey, async ({ ctx, params }) => {
    const result = await refusing(() => verifyKey(ctx, params.accountId));
    if (result !== "read-only") throw new ApiRefusal("conflict", "not_read_only");
  });
  serve(app, guard, connection.replaceKey, async ({ ctx, params, body }) => {
    await refusing(() => replaceKey(ctx, params.accountId, body.credentials));
  });
  serve(app, guard, connection.disconnectProvider, async ({ ctx, params }) => {
    await refusing(() => disconnectProvider(ctx, params.accountId));
  });
  serve(app, guard, connection.confirmKeyRevoked, async ({ ctx, params }) => {
    await refusing(() => confirmKeyRevoked(ctx, params.accountId));
  });
}

/** Every route of investments. */
export function serveInvestments(
  app: Hono<ApiEnv>,
  guard: Guard,
  cases: InvestmentCases,
): readonly RouteContract[] {
  serveReads(app, guard);
  serveTabs(app, guard);
  serveRegister(app, guard);
  serveConnection(app, guard, cases);
  return INVESTMENTS_ROUTES;
}
