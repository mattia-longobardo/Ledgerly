// Investments (rewrite plan R2, 05-refactor.md §5.5): every route of the module, all of them the
// domain's use cases, the ones the pages and the Server Actions call. The bodies arrive in canonical
// form (amounts "1234.56", quantities and prices plain decimals) and become the domain's cents and
// fixed-point decimals here, nowhere else. Hono tries the routes in order: `/investments/home`,
// `/catalog` and `/connections` come before `/investments/{accountId}`.
import type { Hono } from "hono";
import type { z } from "zod";
import { INVESTMENTS, INVESTMENTS_ROUTES, type RouteContract } from "@ledgerly/api-contract";
import { accountsView } from "@ledgerly/domain/accounts";
import {
  catalogView,
  checkSyncNow,
  confirmKeyRevoked,
  confirmZeroReading,
  connectInvestmentProvider,
  assetPrices,
  createManualService,
  createManualServiceWithAccount,
  createPortfolio,
  createPortfolioWithAccount,
  deleteOperation,
  disconnectProvider,
  investmentsHome,
  investmentsPnl,
  investmentsPnlView,
  investmentsPortfolio,
  investmentsSnapshot,
  type InvestmentsSnapshot,
  plansOfEvents,
  linkTransfer,
  type PeriodParams,
  pnlPeriodOf,
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
  unlinkTransfer,
  updateServiceUrl,
  updateServiceValue,
  verifyKey,
} from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { parseCents } from "@ledgerly/domain/shared/money";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { holdingsOut, listOut } from "./dto";
import { activityOut, homeOut, movementsOut, overviewOut } from "./pages";
import { catalogOut, connectionOut, positionsOut } from "./tabs";
import { fundLayers, fundsHomeOf, fundsListOut, portfolioJson, portfolioOf, portfolioOut } from "./portfolio";
import { servePlans } from "./plan-routes";
import { operationInput, readNewMarkets, servePortfolio, writeOperation } from "./portfolio-routes";
import { decimal, notFound, refusing } from "./refusals";

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
  /** The daily prices, now: a market just entered a portfolio (`tasks.job("instrument-prices")`). */
  queuePrices(ctx: Ctx): Promise<void>;
}

/** A page of events, with the plan of each purchase a plan wrote (R5d). */
async function withPlans<T extends { rows: readonly { id: string }[] }>(ctx: Ctx, activity: T | null) {
  if (activity === null) return null;
  return {
    ...activity,
    plans: await plansOfEvents(
      ctx,
      activity.rows.map((row) => row.id),
    ),
  };
}

const found = <T>(value: T | null): T => {
  if (value === null) throw notFound();
  return value;
};

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

type HomeQuery = z.infer<(typeof investments.getInvestmentsHome)["query"]>;
type Chip = NonNullable<HomeQuery["group"]>;

/** The chart's first day for a chip: the earliest of its groups' first data. */
const firstOfChip =
  (chip: Chip, fundsFirstOn: CivilDate | null) =>
  (services: CivilDate | null): CivilDate | null =>
    [chip === "all" ? services : null, fundsFirstOn].filter((day) => day !== null).sort()[0] ?? null;

/**
 * The home of a period. Without `group` the chart of before, the services only; with it, the chip's
 * layers from the chip's first data, on the scale of its KPIs.
 */
async function homeAnswer(ctx: Ctx, query: HomeQuery) {
  const { group } = query;
  const snapshot = await investmentsSnapshot(ctx);
  const period = pnlPeriodOf(periodOf(ctx, query), snapshot.todayOn);
  const funds =
    group === undefined || group === "stocks_crypto"
      ? undefined
      : await fundsHomeOf(ctx, period, snapshot.todayOn);
  const [home, pnl, { rows }] = await Promise.all([
    investmentsHome(ctx, snapshot),
    investmentsPnlView(ctx, period, snapshot, funds && firstOfChip(group!, funds.firstOn)),
    accountsView(ctx, { months: 1 }),
  ]);
  const portfolio = await portfolioOf(ctx, { rows, portfolio: home, pnl, funds });
  const parts = portfolioJson(portfolio);
  if (group === undefined) return homeOut(home, pnl, parts);
  const kpis = group === "all" ? portfolio.total : portfolio.groups.find((one) => one.group === group)?.kpis;
  const currencyOf = new Map(rows.map((row) => [row.account.id, row.account.currency]));
  return homeOut(home, pnl, parts, {
    services: group !== "pension_funds",
    funds: funds ? await fundLayers(ctx, funds, pnl, currencyOf) : [],
    gainCents: kpis?.gainCents ?? null,
    rate: kpis?.rate ?? null,
  });
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
  return { detail, view, prices: await assetPrices(detail.assets, snapshot.todayOn) };
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
    // Without `include=funds` the answer of before, to the field (R5b).
    if (query.include !== "funds") return listOut(portfolio, pnl);
    const { rows } = await accountsView(ctx, { months: 1 });
    return { ...listOut(portfolio, pnl), ...(await portfolioOut(ctx, { rows, portfolio, pnl })) };
  });
  serve(app, guard, INVESTMENTS.funds.listFunds, async ({ ctx }) => fundsListOut(ctx));
  // The literal paths first: `/investments/{accountId}` would take them.
  serve(app, guard, investments.getInvestmentsHome, async ({ ctx, query }) => homeAnswer(ctx, query));
  serve(app, guard, investments.getInvestmentsCatalog, async ({ ctx }) => catalogOut(await catalogView(ctx)));
  serve(app, guard, investments.getInvestmentHoldings, async ({ ctx, params }) =>
    holdingsOut(found(await serviceHoldings(ctx, params.accountId))),
  );
  serve(app, guard, investments.getInvestment, async ({ ctx, params, query }) => {
    const period = periodOf(ctx, query);
    const {
      detail,
      view: pnl,
      prices,
    } = await withDetail(ctx, params.accountId, (snapshot) =>
      servicePnlView(ctx, params.accountId, period, snapshot),
    );
    const activity = await serviceActivity(ctx, params.accountId, {
      ...pnl.span,
      family: null,
      q: null,
      assetId: null,
      page: 1,
    });
    return overviewOut(detail, pnl, await withPlans(ctx, activity), prices);
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
    return activityOut(detail, pnl, found(await withPlans(ctx, activity)));
  });
  serve(app, guard, investments.getInvestmentPositions, async ({ ctx, params, query }) => {
    const period = periodOf(ctx, query);
    const { detail, view } = await withDetail(ctx, params.accountId, (snapshot) =>
      servicePositions(ctx, params.accountId, period, snapshot),
    );
    return positionsOut(detail, view, await assetPrices([...view.assets.values()], view.todayOn));
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

function serveRegister(app: Hono<ApiEnv>, guard: Guard, cases: InvestmentCases): void {
  serve(app, guard, register.createManualService, async ({ ctx, body }) =>
    refusing(() => {
      if ("kind" in body) {
        return "accountId" in body
          ? createPortfolio(ctx, { accountId: body.accountId, url: body.url })
          : createPortfolioWithAccount(ctx, { name: body.name, currency: body.currency, url: body.url });
      }
      return "accountId" in body
        ? createManualService(ctx, body)
        : createManualServiceWithAccount(ctx, { ...body, valueCents: parseCents(body.value) });
    }),
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
    const { eventId } = await refusing(async () =>
      writeOperation(ctx, params.accountId, body, (input) =>
        recordOperation(ctx, params.accountId, operationInput(input)),
      ),
    );
    if (body.kind === "buy") await readNewMarkets(ctx, params.accountId, cases);
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
  serveRegister(app, guard, cases);
  serveConnection(app, guard, cases);
  servePortfolio(app, guard, cases);
  servePlans(app, guard);
  return INVESTMENTS_ROUTES;
}
