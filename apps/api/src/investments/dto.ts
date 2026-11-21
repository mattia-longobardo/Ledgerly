// Investments · the one serializer (rewrite plan R2, 05-refactor.md §5.5): `GET /investments` and the
// holdings of a service as the legacy routes answered them, and what the pages' reads share
// (`pages.ts`, `tabs.ts`). The routes and the tools `list_investments`, `get_investment_holdings` and
// `get_investment` answer through these. The numbers are the domain's queries, the ones the pages
// read; here they change form and are summed as the pages sum them, never changed.
import {
  accountTypeOf,
  connectableProvider,
  contributionsOf,
  type HoldingRow,
  type InvestmentsPnl,
  type PnlParts,
  type Portfolio,
  type ServiceDetail,
  type ServicePnl,
  type ServiceSummary,
  serviceHoldings,
  servicePnlView,
  type Xirr,
} from "@ledgerly/domain/investments";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { type Cents, centsToDecimal, sumCents } from "@ledgerly/domain/shared/money";

/** A service's view of the period, or the home's: the page's query. */
export type View = NonNullable<Awaited<ReturnType<typeof servicePnlView>>>;
type Holdings = NonNullable<Awaited<ReturnType<typeof serviceHoldings>>>;
type Contributions = ReturnType<typeof contributionsOf>;
type PeriodReturn = ServicePnl["displayReturn"];

export const money = (cents: Cents): string => centsToDecimal(cents);
export const maybe = (cents: Cents | null): string | null => (cents === null ? null : centsToDecimal(cents));
export const iso = (moment: Date | null): string | null => (moment === null ? null : moment.toISOString());

/** A return, a share or a weight: a ratio rounded to 6 decimals; not a number is null. */
export function ratio(value: number | null): number | null {
  return value === null || !Number.isFinite(value) ? null : Number(value.toFixed(6));
}

export const round = (value: number): number => ratio(value) ?? 0;

/** Why XIRR is missing: no value or no complete history, or no single solution. */
function xirrJson(result: Xirr | null) {
  if (result === null) return { xirr: null, xirrStatus: "unavailable" as const };
  if (result.status === "ok") return { xirr: ratio(result.rate), xirrStatus: "ok" as const };
  return {
    xirr: null,
    xirrStatus: result.status === "none" ? ("no_solution" as const) : ("multiple_solutions" as const),
  };
}

/** The day of an instant in UTC, as the legacy answer wrote `reliableFrom`. */
function civil(moment: Date | null): CivilDate | null {
  return moment ? moment.toISOString().slice(0, 10) : null;
}

function serviceJson(one: ServiceSummary) {
  return {
    accountId: one.account.id,
    name: one.account.name,
    category: one.investment.category,
    provider: one.investment.provider,
    origin: one.origin,
    mode: one.mode,
    currency: one.account.currency,
    value: maybe(one.valueCents),
    displayValue: maybe(one.displayCents),
    change30Days: maybe(one.change30Cents),
    invested: maybe(one.performance.investedCents),
    gain: maybe(one.performance.gainCents),
    simpleReturn: ratio(one.performance.simpleReturn),
    ...xirrJson(one.xirr),
    reliable: one.reliable,
    reliableFrom: civil(one.reliableFrom),
    weight: ratio(one.weight),
    lastUpdate: one.lastUpdate,
  };
}

/** The export's own form of XIRR, from before the contract: the rate, or why there is none. */
const EXPORT_XIRR = { unavailable: null, no_solution: "none", multiple_solutions: "multiple" } as const;

/**
 * The export's section `investment-services` (decisions D9, D10, audit INV-5): each service as
 * `GET /investments` lists it, the archived ones too with `archived`, and `modifiedDietz`, its
 * return of the period of `result` (the API's field). The export keeps its columns: `xirr` and
 * `reliableFrom` (the instant) stay in the forms it always wrote.
 */
export function exportServicesOut(portfolio: Portfolio, result: InvestmentsPnl) {
  const dietz = new Map(pnlJson(result).services.map((one) => [one.accountId, one.modifiedDietz]));
  return portfolio.services.map((one) => {
    const json = serviceJson(one);
    return {
      name: json.name,
      category: json.category,
      provider: json.provider,
      mode: json.mode,
      currency: json.currency,
      value: json.value,
      invested: json.invested,
      gain: json.gain,
      simpleReturn: json.simpleReturn,
      xirr: json.xirrStatus === "ok" ? json.xirr : EXPORT_XIRR[json.xirrStatus],
      reliableFrom: iso(one.reliableFrom),
      modifiedDietz: dietz.get(one.account.id) ?? null,
      archived: one.account.state === "archived",
    };
  });
}

export function totalsJson(totals: Portfolio["totals"]) {
  return {
    value: maybe(totals.valueCents),
    valuePartial: totals.partial,
    invested: maybe(totals.investedCents),
    gain: maybe(totals.gainCents),
    simpleReturn: ratio(totals.simpleReturn),
    ...xirrJson(totals.xirr),
    includesExchangeEffect: totals.fxEffect,
  };
}

function partsJson(parts: PnlParts | null) {
  if (parts === null) return null;
  return {
    pnl: money(parts.pnlCents),
    realized: money(parts.realizedCents),
    unrealized: maybe(parts.unrealizedChangeCents),
    income: money(parts.incomeCents),
    fees: money(parts.feesCents),
    corrections: money(parts.correctionsCents),
    fx: money(parts.fxCents),
  };
}

/** The parts with what no part explains, as the pages' P&L reads them. */
export function fullParts(parts: PnlParts | null) {
  return parts === null ? null : { ...partsJson(parts)!, unattributed: money(parts.unattributedCents) };
}

/**
 * `GET /investments` and `list_investments` (docs/design/investments.md §5.5, SEC-08): the services
 * and the portfolio today, and `pnl`, the P&L of the period with its Modified Dietz return (D9) —
 * the portfolio's and each service's in the display currency, as the home and the Overview show it.
 * Nothing of a connection: no key, no key check, no last error, no state of the sync.
 */
export function listOut(portfolio: Portfolio, result: InvestmentsPnl) {
  return {
    on: portfolio.todayOn,
    currency: portfolio.currency,
    totals: totalsJson(portfolio.totals),
    services: portfolio.services.map(serviceJson),
    pnl: pnlJson(result),
  };
}

/**
 * The P&L of the period (docs/design/investments-ux.md §4, PERS-145): the parts add up to `pnl`;
 * `services` add up to the portfolio with `transfers`. In the display `currency`, a service's
 * `local` in its own.
 */
export function pnlJson(result: InvestmentsPnl) {
  const { portfolio } = result;
  return {
    period: { kind: result.period.kind, from: result.period.from, to: result.period.to },
    currency: result.currency,
    status: portfolio.status,
    ...partsJson(portfolio.parts),
    transfers: money(portfolio.transfersCents),
    services: portfolio.services.map((one) => ({
      accountId: one.accountId,
      status: one.status,
      from: one.from,
      to: one.to,
      openPositions: one.openPositions,
      display: partsJson(one.display),
      local: { currency: one.currency, ...partsJson(one.local) },
      modifiedDietz: ratio(one.displayReturn?.dietz ?? null),
    })),
    modifiedDietz: ratio(portfolio.rate),
  };
}

function holdingJson(row: HoldingRow) {
  return {
    asset: {
      name: row.asset.name,
      class: row.asset.class,
      symbol: row.asset.symbol,
      isin: row.asset.isin,
      currency: row.asset.currency,
    },
    product: row.product,
    origin: row.origin,
    quantity: row.quantityText,
    unitPrice: row.priceText,
    priceCurrency: row.state.priceCurrency,
    pricedOn: row.state.pricedOn,
    value: maybe(row.state.valueCents),
    gain: maybe(row.gainCents),
    weight: ratio(row.weight),
    conflict: row.conflict,
  };
}

/** `GET /investments/{accountId}/holdings` and `get_investment_holdings`: the open positions today. */
export function holdingsOut(view: Holdings) {
  return {
    accountId: view.account.id,
    name: view.account.name,
    currency: view.currency,
    on: view.on,
    holdings: view.holdings.map(holdingJson),
  };
}

// ——— What the pages share ————————————————————————————————————————————————————————————————————

export function periodOut(view: Pick<View, "period" | "span" | "firstOn">) {
  const { period, span, firstOn } = view;
  return { kind: period.kind, year: period.year, from: period.from, to: period.to, span, firstOn };
}

function returnOut(measured: PeriodReturn) {
  if (measured === null) return null;
  return {
    modifiedDietz: ratio(measured.dietz),
    method: measured.method,
    ...xirrJson(measured.xirr),
    largeFlows: measured.largeFlows,
  };
}

export function servicePnlOut(one: ServicePnl) {
  return {
    accountId: one.accountId,
    status: one.status,
    reasons: one.reasons,
    from: one.from,
    to: one.to,
    partial: one.partial,
    start: maybe(one.startCents),
    end: maybe(one.endCents),
    endCash: maybe(one.endCashCents),
    openPositions: one.openPositions,
    local: fullParts(one.local),
    display: fullParts(one.display),
    localReturn: returnOut(one.localReturn),
    displayReturn: returnOut(one.displayReturn),
  };
}

/** The four things to check with an action (§3.2), and how many of them ask for one. */
export function warningsOut(warnings: ServiceSummary["warnings"]) {
  const alerts = [
    warnings.conflicts > 0,
    warnings.pendingZero,
    warnings.missingPrices > 0,
    warnings.openAdjustments > 0,
  ].filter(Boolean).length;
  return { ...warnings, alerts };
}

/** A service as a list names it: its row, its colour (its account's, or the palette's at `colorIndex`) and its warnings. */
export function listedOut(one: ServiceSummary, colorIndex: number) {
  return {
    ...serviceJson(one),
    color: one.account.color,
    colorIndex,
    warnings: warningsOut(one.warnings),
  };
}

const runningTotal = (values: readonly (Cents | null)[]) => {
  let total = 0n;
  return values.map((cents) => (cents === null ? null : (total += cents)));
};

/** The charts of the period, with the sums the page draws: each bar of the services, its running total, each day's value. */
export function chartOut(view: View) {
  const bars = view.intervals.map((_interval, index) => {
    const known = view.chart.map((one) => one.bars[index]).filter((cents) => cents !== null);
    return known.length === 0 ? null : known.reduce<Cents>((sum, cents) => sum + cents!, 0n);
  });
  return {
    barGrain: view.barGrain,
    intervals: view.intervals,
    valueGrain: view.valueGrain,
    valueDays: view.valueDays,
    services: view.chart.map((one) => ({
      accountId: one.accountId,
      bars: one.bars.map(maybe),
      values: one.values.map(maybe),
    })),
    bars: bars.map(maybe),
    cumulative: runningTotal(bars).map(maybe),
    values: view.valueDays.map((_day, index) =>
      maybe(sumCents(view.chart.map((one) => one.values[index])).total),
    ),
  };
}

export function contributionsOut(found: Contributions) {
  if (found === null) return null;
  return {
    rows: found.rows.map((row) => ({
      key: row.key,
      holdingId: row.holdingId,
      assetId: row.assetId,
      product: row.product,
      pnl: money(row.cents),
      realized: money(row.realizedCents),
      unrealized: maybe(row.unrealizedChangeCents),
      open: row.open,
      sold: row.sold,
      costUnknown: row.costUnknown,
      bar: round(row.bar),
    })),
    income: money(found.incomeCents),
    fees: money(found.feesCents),
    corrections: money(found.correctionsCents),
    valueChange: money(found.valueChangeCents),
    unattributed: money(found.unattributedCents),
    total: money(found.totalCents),
  };
}

export function assetOut(asset: ServiceDetail["assets"][number]) {
  return {
    id: asset.id,
    name: asset.name,
    class: asset.class,
    symbol: asset.symbol,
    isin: asset.isin,
    currency: asset.currency,
  };
}

/** A provider a key connects, as the key dialogs take it: the names of its fields, never a value. */
export function connectableOut(id: string) {
  const one = connectableProvider(id);
  if (!one) return null;
  return {
    id: one.id,
    name: one.name,
    category: one.category,
    accountType: accountTypeOf(one.category),
    credentialFields: [...one.credentialFields],
    currencies: one.currencies === null ? null : [...one.currencies],
    defaultCurrency: one.defaultCurrency,
    ipWhitelist: one.ipWhitelist,
    url: one.url,
    revokeUrl: one.revokeUrl,
  };
}

/** What each sale realized in the period, by event: the engine's exits. */
