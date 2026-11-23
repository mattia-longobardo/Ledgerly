// Investments · the tabs of a service that are no page of the home, and the catalog (rewrite plan R2,
// 05-refactor.md §5.5): Positions, Connection (the session's only, SEC-08) and the catalog.
import type { z } from "zod";
import type { INVESTMENTS } from "@ledgerly/api-contract";
import {
  accountTypeOf,
  catalogView,
  closedGroups,
  contributionsOf,
  type HoldingPnl,
  onCostOf,
  periodReturnOf,
  type PositionAt,
  PRICE_SCALE,
  QUANTITY_SCALE,
  type ServiceDetail,
  servicePositions,
  unitPriceOf,
  type AssetPrice,
} from "@ledgerly/domain/investments";
import { addDays, type CivilDate, civilDateIn } from "@ledgerly/domain/shared/dates";
import { type Cents, formatDecimal } from "@ledgerly/domain/shared/money";
import {
  assetOut,
  connectableOut,
  contributionsOut,
  iso,
  maybe,
  money,
  periodOut,
  ratio,
  warningsOut,
} from "./dto";

type Reads = typeof INVESTMENTS.investments;
type Positions = z.input<Reads["getInvestmentPositions"]["response"]>;
type Connection = z.input<Reads["getInvestmentConnection"]["response"]>;
type Catalog = z.input<Reads["getInvestmentsCatalog"]["response"]>;
type PositionsData = NonNullable<Awaited<ReturnType<typeof servicePositions>>>;
type Sync = NonNullable<ServiceDetail["sync"]>;

function positionAtOut(position: PositionAt) {
  const { quantity, costCents } = position;
  return {
    quantity: quantity === null ? null : formatDecimal(quantity, QUANTITY_SCALE),
    unitPrice: position.unitPrice === null ? null : formatDecimal(position.unitPrice, PRICE_SCALE),
    priceCurrency: position.priceCurrency,
    value: maybe(position.valueCents),
    cost: maybe(costCents),
    costSource: position.costSource,
    unrealized: maybe(position.unrealizedCents),
    averageCost:
      quantity === null || quantity <= 0n || costCents === null
        ? null
        : formatDecimal(unitPriceOf(costCents, quantity), PRICE_SCALE),
    onCost: ratio(onCostOf(position)),
  };
}

type Exits = PositionsData["allExits"];
type OpenRow = HoldingPnl & { end: PositionAt };
type AssetClass = ServiceDetail["assets"][number]["class"];

/** The exits by position, in the period or ever (S10), and what they realized; null when some cost is unknown. */
function closedOut(exits: Exits, holdings: PositionsData["holdings"]) {
  const groups = closedGroups(exits);
  return {
    groups: groups.map((group) => {
      const holding = holdings.get(group.holdingId);
      return {
        holdingId: group.holdingId,
        assetId: holding?.assetId ?? null,
        product: holding?.product ?? null,
        origin: holding?.origin ?? null,
        count: group.count,
        positions: group.positions,
        openedOn: group.openedOn,
        closedOn: group.closedOn,
        cost: money(group.costCents),
        proceeds: money(group.proceedsCents),
        realized: maybe(group.realizedCents),
        onCost: ratio(group.onCost),
      };
    }),
    realized: maybe(
      groups.reduce<Cents | null>(
        (sum, group) => (sum === null || group.realizedCents === null ? null : sum + group.realizedCents),
        0n,
      ),
    ),
  };
}

/** The open positions by class, largest first (mockup 05). */
function byClassOf(open: readonly OpenRow[], assets: PositionsData["assets"]) {
  const classes: { key: AssetClass; value: Cents; pnl: Cents }[] = [];
  for (const row of open) {
    const key = (row.assetId === null ? undefined : assets.get(row.assetId)?.class) ?? "other";
    let group = classes.find((one) => one.key === key);
    if (!group) classes.push((group = { key, value: 0n, pnl: 0n }));
    group.value += row.end.valueCents ?? 0n;
    group.pnl += row.contributionCents ?? 0n;
  }
  return classes.sort((left, right) => Number(right.value - left.value));
}

/** Open on the period's last day, by value, with what each added and its share of the total (§3.4). */
function openOut(detail: ServiceDetail, view: PositionsData) {
  const { service } = view;
  const past = view.period.to < view.todayOn;
  const today = new Map(detail.holdings.map((row) => [row.id, row]));
  const open = service.holdings
    .filter((row): row is OpenRow => row.end !== null)
    .sort((left, right) => Number((right.end.valueCents ?? 0n) - (left.end.valueCents ?? 0n)));
  const cash = service.endCashCents === 0n ? null : service.endCashCents;
  const total = open.reduce((sum, row) => sum + (row.end.valueCents ?? 0n), 0n) + (cash ?? 0n);
  const share = (cents: Cents | null) =>
    cents === null || total <= 0n ? null : Number(cents) / Number(total);
  return {
    rows: open.map((row) => {
      // Actions act on today: only on the period still running, and on manual positions (§3.4).
      const holding = row.holdingId === null || past ? undefined : today.get(row.holdingId);
      return {
        key: row.key,
        holdingId: row.holdingId,
        assetId: row.assetId,
        product: row.product,
        origin: row.end.origin,
        at: positionAtOut(row.end),
        pnl: maybe(row.contributionCents),
        periodReturn: ratio(periodReturnOf(row)),
        share: ratio(share(row.end.valueCents)),
        manual:
          holding?.origin === "manual"
            ? { conflict: holding.conflict, byValue: holding.state.quantity === null }
            : null,
      };
    }),
    cash: maybe(cash),
    total: money(total),
    pnl: money(open.reduce<Cents>((sum, row) => sum + (row.contributionCents ?? 0n), 0n)),
    cashShare: ratio(share(cash)),
    noCost: open.filter((row) => row.end.costCents === null).length,
    byClass: byClassOf(open, view.assets).map((group) => ({
      key: group.key,
      value: money(group.value),
      pnl: money(group.pnl),
      share: ratio(share(group.value)),
    })),
  };
}

/** A service's Positions (§3.4): open on the period's last day, closed in it and ever (S10). */
export function positionsOut(
  detail: ServiceDetail,
  view: PositionsData,
  prices: ReadonlyMap<string, AssetPrice>,
): Positions {
  const { service } = view;
  const latest = detail.readings[0];
  return {
    on: view.todayOn,
    period: periodOut(view),
    currency: detail.currency,
    displayCurrency: view.currency,
    status: service.status,
    display:
      service.display === null
        ? null
        : { pnl: money(service.display.pnlCents), fx: money(service.display.fxCents) },
    startOn: service.from === null ? null : addDays(service.from, -1),
    open: openOut(detail, view),
    closedInPeriod: closedOut(service.exits, view.holdings),
    closedEver: closedOut(view.allExits, view.holdings),
    contributions: contributionsOut(contributionsOf(service)),
    dust: view.dust,
    assets: [...view.assets.values()].map((asset) => assetOut(asset, prices)),
    latestReading: latest ? { id: latest.id, on: latest.on } : null,
  };
}

type CoverageRow = Sync["coverage"][number];

function coverageOut(row: CoverageRow) {
  return {
    kind: row.kind,
    stream: row.stream,
    from: row.fromAt.toISOString(),
    to: row.toAt.toISOString(),
    status: row.status,
    reason: row.reason,
  };
}

/**
 * The coverage on the days the service reads (PERS-145), by the person's day as the engine reads them:
 * before `managedSince` nothing is kept, so a window that ends on or before it goes, one across it starts there.
 */
function visibleCoverage(sync: Sync, managedSince: CivilDate, timeZone: string) {
  const dayOf = (moment: Date) => civilDateIn(moment, timeZone);
  const since = new Date(`${managedSince}T00:00:00Z`);
  const visible = sync.coverage
    .filter((row) => dayOf(row.toAt) > managedSince)
    .map((row) => (dayOf(row.fromAt) < managedSince ? { ...row, fromAt: since } : row));
  const flows = visible.filter(
    (row) => row.kind === "flows" && row.stream !== "quantities" && row.stream !== "balance_history",
  );
  return {
    visibleCoverage: visible.map(coverageOut),
    activityFrom: flows.length === 0 ? null : flows.map((row) => dayOf(row.fromAt)).sort()[0],
  };
}

function syncOut(
  sync: Sync,
  connectionId: string | null,
  managedSince: CivilDate,
  timeZone: string,
): NonNullable<Connection["sync"]> {
  return {
    provider: sync.provider,
    connected: sync.connected,
    state: sync.state,
    connectionId,
    lastOkAt: iso(sync.lastOkAt),
    lastError: sync.lastError,
    nextSyncAt: iso(sync.nextSyncAt),
    lastCheck:
      sync.lastCheck === null
        ? null
        : {
            result: sync.lastCheck.result,
            checkedAt: sync.lastCheck.checkedAt.toISOString(),
            ipRestricted: sync.lastCheck.ipRestricted,
          },
    keySetAt: iso(sync.keySetAt),
    rotateDue: sync.rotateDue,
    revokePending: sync.revokePending,
    coverage: sync.coverage.map(coverageOut),
    reliableFrom: iso(sync.reliableFrom),
    complete: sync.complete,
    ...visibleCoverage(sync, managedSince, timeZone),
  };
}

/** A service's Connection, or Settings for a manual one (§3.6): the session's only (SEC-08). */
export function connectionOut(
  detail: ServiceDetail,
  todayOn: CivilDate,
  connectionId: string | null,
  timeZone: string,
): Connection {
  const { summary } = detail;
  return {
    on: todayOn,
    accountId: summary.account.id,
    name: summary.account.name,
    currency: detail.currency,
    warnings: warningsOut(summary.warnings),
    provider: detail.sync === null ? null : connectableOut(detail.sync.provider),
    sync:
      detail.sync === null
        ? null
        : syncOut(detail.sync, connectionId, summary.investment.managedSince, timeZone),
    readings: detail.readings.map((reading) => ({
      id: reading.id,
      on: reading.on,
      status: reading.status,
      total: money(reading.totalCents),
      products: reading.products,
      unread: reading.unread,
      missingPrices: reading.missingPrices,
    })),
    reconstructedReadings: detail.reconstructedReadings,
    firstReadOn: detail.firstReadOn,
    adjustments: detail.adjustments.map((one) => ({
      eventId: one.eventId,
      on: one.on,
      amount: money(one.amountCents),
      validUntil: one.validUntil,
      note: one.note,
      stale: one.stale,
      adjustmentClass: one.adjustmentClass,
    })),
    settings: {
      mode: summary.mode,
      managedSince: summary.investment.managedSince,
      url: summary.investment.url,
      periods: detail.periods,
    },
  };
}

/** The catalog (§4.2): the providers, the ones to come too, and the accounts a service can use. */
export function catalogOut(view: Awaited<ReturnType<typeof catalogView>>): Catalog {
  return {
    providers: view.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      category: provider.category,
      accountType: accountTypeOf(provider.category),
      credentialFields: [...provider.credentialFields],
      currencies: provider.currencies === null ? null : [...provider.currencies],
      defaultCurrency: provider.defaultCurrency,
      ipWhitelist: provider.ipWhitelist,
      url: provider.url,
      revokeUrl: provider.revokeUrl,
      connect: provider.connect,
      status: provider.status,
      connected: provider.connected,
    })),
    existing: view.existing.map((one) => ({
      id: one.id,
      name: one.name,
      currency: one.currency,
      type: one.type,
      balance: maybe(one.balanceCents),
      reason: one.reason,
      synced: one.synced,
      manualService: one.manualService,
    })),
  };
}
