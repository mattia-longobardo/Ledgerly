// The P&L of a period (docs/design/investments-ux.md §4, U1-U4): the home, a service's Overview and Positions.
import { reconstructedBalances } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { addDays, civilDateIn, type CivilDate } from "../../../shared/dates";
import { convertCents, NO_RATES, type RateTable } from "../../../platform/fx/rules";
import { ratesOn } from "../../../platform/fx/service";
import { externalIdsOf } from "../../../platform/integrations/service";
import { type Cents } from "../../../shared/money";
import { isUnpricedDust, QUANTITY_SCALE } from "../rules";
import { parseDecimal } from "../../../shared/money";
import { type InvestmentAsset, listAssets } from "../service";
import {
  type CoverageWindow,
  type Exit,
  type PeriodParams,
  periodOf,
  type PnlPeriod,
  pnlOf,
  type PnlService,
  pnlThrough,
  portfolioPnl,
  type PortfolioPnl,
  replayHoldings,
  type ServicePnl,
  firstDayOf,
} from "../pnl";
import { type BarGrain, barIntervals, type Interval, periodSpan, valueDays } from "../period";
import { type SyncStatus } from "../sync";
import { trimmed } from "./holdings";
import { type ArchivedOption, readingPositionsOf } from "./home";
import { type InvestmentsSnapshot, type Loaded, servicesOf, snapshotOf } from "./snapshot";

// ——— Profit and loss of a period (docs/design/investments-ux.md §4, U1) ——————————————————————————

export interface InvestmentsPnl {
  period: PnlPeriod;
  todayOn: CivilDate;
  currency: string;
  /** Every live service with its own P&L, and the portfolio's (§4.6, §4.8). */
  portfolio: PortfolioPnl;
}

/**
 * The flows a provider's coverage says it holds, by day (§4.6): the `flows` windows but the
 * `quantities` stream, which says whether the quantities add up and nothing about the flows.
 */
function coverageOf(sync: SyncStatus, timeZone: string): { windows: CoverageWindow[]; mismatch: boolean } {
  const flows = sync.coverage.filter((row) => row.kind === "flows");
  return {
    windows: flows
      .filter((row) => row.stream !== "quantities")
      .map((row) => ({
        stream: row.stream,
        fromOn: civilDateIn(row.fromAt, timeZone),
        toOn: civilDateIn(row.toAt, timeZone),
        complete: row.status === "complete",
      })),
    // `quantity_mismatch` or `negative_opening` (A6): either way the quantities do not add up.
    mismatch: flows.some((row) => row.stream === "quantities" && row.status !== "complete"),
  };
}

/** The inputs of the engine for every live service, and the rates to the display currency (§4.5). */
async function pnlInputs(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  live: Loaded[],
  period: PnlPeriod,
  todayOn: CivilDate,
): Promise<{ services: PnlService[]; display: { currency: string; rates: RateTable } }> {
  const currency = ctx.displayCurrency;
  const services: PnlService[] = [];
  for (const one of live) {
    const synced = one.investment.provider !== "manual" && one.sync !== null;
    const coverage = synced ? coverageOf(one.sync!, ctx.timeZone) : null;
    const externalIds = synced
      ? await externalIdsOf(
          ctx,
          one.investment.provider,
          "investment_event",
          one.book.events.map((event) => event.id),
        )
      : new Map<string, string>();
    services.push({
      accountId: one.account.id,
      currency: one.account.currency,
      book: one.book,
      rates: one.rates,
      coverage: coverage?.windows ?? null,
      externalIds,
      adjustmentClasses: new Map(
        one.book.operationRows.flatMap((op) =>
          op.kind === "adjustment" && op.adjustmentClass ? [[op.eventId, op.adjustmentClass] as const] : [],
        ),
      ),
    });
  }

  const earliest = period.from ?? firstDayOfAll(live) ?? todayOn;
  const converts = live.some((one) => one.account.currency !== currency);
  const rates = converts
    ? await ratesOn(
        new Set([currency, ...live.map((one) => one.account.currency)]),
        addDays(earliest, -8),
        period.to,
      )
    : NO_RATES;
  return { services, display: { currency, rates } };
}

/** The first day any live service has something: its first period or its first event. */
/** The first day of any of the books: the earliest of each book's own first day. */
function firstDayOfAll(live: Loaded[]): CivilDate | null {
  const firsts = live.flatMap((one) => firstDayOf(one.book) ?? []);
  return firsts.length === 0 ? null : firsts.reduce((a, b) => (a < b ? a : b));
}

/**
 * The P&L of the period (§4) of every live service and of the portfolio, in the display currency:
 * the engine of `pnl.ts` on each book, with its coverage, its provider ids (eToro's `positionId`)
 * and the rates from the earliest day measured.
 */
export async function investmentsPnl(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  source: Date | InvestmentsSnapshot = new Date(),
  options: ArchivedOption = {},
): Promise<InvestmentsPnl> {
  const { todayOn, loaded } = await snapshotOf(ctx, source);
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const live = options.includeArchived ? loaded : loaded.filter((one) => one.account.state !== "archived");
  const { services, display } = await pnlInputs(ctx, live, period, todayOn);
  return {
    period,
    todayOn,
    currency: display.currency,
    portfolio: portfolioPnl(
      services.map((one) => pnlOf(one, period.from, period.to, display)),
      display.currency,
    ),
  };
}

export interface PnlChartService {
  accountId: string;
  /** The P&L of each bar in the display currency; `null` before the service is measured. */
  bars: (Cents | null)[];
  /** The value at each point in the display currency, at the rate of its day. */
  values: (Cents | null)[];
}

/**
 * The chart's first day from the services' own: the application's, when the chart draws other groups
 * too (the pension funds of the home) and starts at the first data of any of them.
 */
type FirstOf = (services: CivilDate | null) => CivilDate | null;

export interface InvestmentsPnlView extends InvestmentsPnl {
  /** The first day with data: where "All" starts and the stepper stops (§2.1). */
  firstOn: CivilDate | null;
  /** The days the period really spans, "All" from `firstOn`. */
  span: { from: CivilDate; to: CivilDate };
  /** The P&L chart (§2.2): bars by week, month or year, one layer per service. */
  barGrain: BarGrain;
  intervals: Interval[];
  /** The value chart (§2.2): every day, or month ends. */
  valueGrain: "day" | "month";
  valueDays: CivilDate[];
  chart: PnlChartService[];
  /** The place of each live service in Overview's account order: its colour (§0.6). */
  colorIndex: Map<string, number>;
}

/**
 * The home of the section (docs/design/investments-ux.md §3.1, U2): the P&L of the period, and the
 * chart that explains it — the P&L of each bar by service, and the value of each service. A bar is
 * the difference of the P&L measured from the service's first day to the bar's last one, so the
 * bars of a service add up to its P&L exactly, the last ending on the hero's own number.
 */
export async function investmentsPnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  source: Date | InvestmentsSnapshot = new Date(),
  firstOf?: FirstOf,
): Promise<InvestmentsPnlView> {
  return pnlView(ctx, params, await snapshotOf(ctx, source), { firstOf });
}

/**
 * One service's view of the period (§3.3, U3): the same engine, inputs and bars as the home, so the
 * service's P&L in the display currency is the number of its row there, to the cent (PERS-113 · 5).
 * `null` when the person has no such service.
 */
export async function servicePnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  params: PeriodParams | PnlPeriod,
  source: Date | InvestmentsSnapshot = new Date(),
): Promise<InvestmentsPnlView | null> {
  const view = await pnlView(ctx, params, await snapshotOf(ctx, source, accountId), { only: accountId });
  return view.portfolio.services.length === 0 ? null : view;
}

export interface ServicePositions {
  period: PnlPeriod;
  todayOn: CivilDate;
  /** The display currency. */
  currency: string;
  firstOn: CivilDate | null;
  span: { from: CivilDate; to: CivilDate };
  service: ServicePnl;
  /** Every asset a row can name: the catalog, the provider's included. */
  assets: Map<string, InvestmentAsset>;
  /** Every holding of the service: what a closed row is. */
  holdings: Map<string, { assetId: string; product: string; origin: "manual" | "provider" }>;
  /** Every exit up to today: "All closed" (S10). */
  allExits: Exit[];
  /** The dust the reading in force on the period's last day leaves out (V4). */
  dust: { assetId: string; product: string; quantity: string }[];
}

/**
 * The Positions tab (docs/design/investments-ux.md §3.4, U4): the service's P&L of the period with
 * its positions at both ends — open on the last day, and the ones the period sold — from the same
 * engine and inputs as the Overview, so the rows add up to its number (PERS-113 · 1, 4, 5).
 */
export async function servicePositions(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  accountId: string,
  params: PeriodParams | PnlPeriod,
  source: Date | InvestmentsSnapshot = new Date(),
): Promise<ServicePositions | null> {
  const snapshot = await snapshotOf(ctx, source, accountId);
  const { todayOn } = snapshot;
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const one = servicesOf(snapshot, accountId)[0];
  if (!one) return null;
  const { services, display } = await pnlInputs(ctx, [one], period, todayOn);
  const firstOn = firstDayOfAll([one]);
  const reading = [...one.book.readingRows]
    .filter((row) => row.on <= period.to && row.status !== "pending_zero")
    .at(-1);
  const dust = reading
    ? (await readingPositionsOf(ctx, reading.id))
        .filter((position) =>
          isUnpricedDust({
            valueCents: position.valueCents,
            quantity: parseDecimal(position.quantity, QUANTITY_SCALE),
          }),
        )
        .map((position) => ({
          assetId: position.assetId,
          product: position.product,
          quantity: trimmed(position.quantity),
        }))
    : [];
  return {
    period,
    todayOn,
    currency: display.currency,
    firstOn,
    span: periodSpan(period, firstOn),
    service: pnlOf(services[0], period.from, period.to, display),
    assets: new Map((await listAssets(ctx)).map((asset) => [asset.id, asset])),
    holdings: new Map(
      one.book.holdingRows.map((holding) => [
        holding.id,
        { assetId: holding.assetId, product: holding.product, origin: holding.origin },
      ]),
    ),
    allExits: replayHoldings(one.book, todayOn, services[0].externalIds).exits,
    dust,
  };
}

async function pnlView(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  params: PeriodParams | PnlPeriod,
  snapshot: InvestmentsSnapshot,
  { only, firstOf = (services) => services }: { only?: string; firstOf?: FirstOf } = {},
): Promise<InvestmentsPnlView> {
  const { todayOn, accounts } = snapshot;
  const period = "kind" in params ? params : periodOf(params, todayOn);
  const loaded = servicesOf(snapshot, only);
  // A service asked by name is shown archived too, as its page always was.
  const live = loaded.filter((one) => only !== undefined || one.account.state !== "archived");
  const { services, display } = await pnlInputs(ctx, live, period, todayOn);
  const measured = services.map((one) => pnlOf(one, period.from, period.to, display));
  const portfolio = portfolioPnl(measured, display.currency);

  const firstOn = firstOf(firstDayOfAll(live));
  const span = periodSpan(period, firstOn);
  const { grain: barGrain, intervals } = barIntervals(span.from, span.to);
  const { grain: valueGrain, days } = valueDays(span.from, span.to);

  const read = await reconstructedBalances(
    ctx,
    live.map((one) => one.account.id),
    { from: days[0], to: days[days.length - 1] },
  );
  const indexOf = new Map(read.days.map((day, index) => [day, index]));
  // The rates of the engine start before the first day measured, so they reach every point.
  const rates = display.rates;

  const chart = live.map((one, at): PnlChartService => {
    const service = services[at];
    const whole = measured[at];
    const stored = read.series.get(one.account.id)?.values ?? [];
    const values = days.map((day) => {
      const cents = stored[indexOf.get(day) ?? -1] ?? null;
      return cents === null ? null : convertCents(cents, one.account.currency, display.currency, day, rates);
    });

    // The P&L from the first day measured to the end of each bar, the last the hero's own (INV-8).
    const through =
      whole.display === null
        ? intervals.map(() => null)
        : [
            ...pnlThrough(
              service,
              whole,
              intervals.slice(0, -1).map((interval) => interval.to),
              display,
            ),
            whole.display.pnlCents,
          ];
    let before: Cents = 0n;
    const bars = through.map((cents) => {
      if (cents === null) return null;
      const bar = cents - before;
      before = cents;
      return bar;
    });
    return {
      accountId: one.account.id,
      bars,
      values,
    };
  });

  const order = accounts.filter((account) => account.state !== "archived");
  return {
    period,
    todayOn,
    currency: display.currency,
    portfolio,
    firstOn,
    span,
    barGrain,
    intervals,
    valueGrain,
    valueDays: days,
    chart,
    colorIndex: new Map(order.map((account, index) => [account.id, index])),
  };
}
