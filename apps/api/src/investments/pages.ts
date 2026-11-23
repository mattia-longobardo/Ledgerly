// Investments · the pages' reads (rewrite plan R2, 05-refactor.md §5.5): the home, a service's
// Overview and its Activity, from the queries the pages read and summed as they sum them.
import type { z } from "zod";
import type { INVESTMENTS } from "@ledgerly/api-contract";
import {
  ACTIVITY_PAGE_SIZE,
  contributionsOf,
  investmentsHome,
  type ServiceDetail,
  investmentProviderName,
  type ServicePnl,
  serviceActivity,
  serviceMovements,
  STALE_VALUE_DAYS,
  type AssetPrice,
} from "@ledgerly/domain/investments";
import type { CivilDate } from "@ledgerly/domain/shared/dates";
import { type Cents, sumCents } from "@ledgerly/domain/shared/money";
import {
  assetOut,
  chartOut,
  connectableOut,
  contributionsOut,
  fullParts,
  iso,
  listedOut,
  maybe,
  money,
  periodOut,
  ratio,
  round,
  servicePnlOut,
  totalsJson,
  type View,
} from "./dto";

type Reads = typeof INVESTMENTS.investments;
type Activity = z.input<Reads["getInvestmentActivity"]["response"]>;
type ActivityRowOut = Extract<Activity, { source: "events" }>["rows"][number];
type Overview = z.input<Reads["getInvestment"]["response"]>;
type Home = z.input<Reads["getInvestmentsHome"]["response"]>;
type HomeData = Awaited<ReturnType<typeof investmentsHome>>;
/** The open funds with their value today, read only (`fundValues` of funds). */
type FundValues = readonly { fund: { id: string; name: string }; valueCents: Cents | null }[];
type ActivityData = NonNullable<Awaited<ReturnType<typeof serviceActivity>>>;
type Movements = NonNullable<Awaited<ReturnType<typeof serviceMovements>>>;

function realizedByEvent(service: ServicePnl): Map<string, Cents> {
  const realized = new Map<string, Cents>();
  for (const exit of service.exits) {
    if (exit.realizedCents === null) continue;
    realized.set(exit.eventId, (realized.get(exit.eventId) ?? 0n) + exit.realizedCents);
  }
  return realized;
}

function activityRowOut(row: ActivityData["rows"][number], realized: Map<string, Cents>): ActivityRowOut {
  return {
    id: row.id,
    on: row.on,
    origin: row.origin,
    note: row.note,
    family: row.family,
    leg: {
      kind: row.leg.kind,
      holdingId: row.leg.holdingId,
      assetName: row.leg.assetName,
      assetClass: row.leg.assetClass,
      product: row.leg.product,
      quantity: row.leg.quantity,
      unitPrice: row.leg.unitPrice,
      priceCurrency: row.leg.priceCurrency,
      amount: money(row.leg.amountCents),
      validUntil: row.leg.validUntil,
    },
    adjustmentClass: row.adjustmentClass,
    transactionId: row.transactionId,
    linked: row.linked === null ? null : { payee: row.linked.payee, amount: money(row.linked.cents) },
    transfer: row.transfer,
    realized: maybe(realized.get(row.id) ?? null),
  };
}

// ——— The pages ——————————————————————————————————————————————————————————————————————————————

/** Positive amounts by key, largest first, with their share of the sum (§3.1, H6). */
function slices(entries: readonly { key: string; name: string; cents: Cents }[]) {
  const total = entries.reduce<Cents>((sum, entry) => sum + entry.cents, 0n);
  return entries
    .filter((entry) => entry.cents > 0n)
    .sort((left, right) =>
      left.cents > right.cents ? -1 : left.cents < right.cents ? 1 : left.name < right.name ? -1 : 1,
    )
    .map((entry) => ({
      key: entry.key,
      value: money(entry.cents),
      share: total > 0n ? round(Number(entry.cents) / Number(total)) : 0,
    }));
}

type Portfolio = View["portfolio"];

/** The services in Overview's colours, ordered by what they added to the period (§3.1, §4.8). */
function homeRows(home: HomeData, pnl: View) {
  const order = new Map(pnl.portfolio.contributions.map((row, index) => [row.accountId, index]));
  const place = (accountId: string) => order.get(accountId) ?? Number.MAX_SAFE_INTEGER;
  return home.services
    .map((summary, index) => ({ summary, colorIndex: pnl.colorIndex.get(summary.account.id) ?? index }))
    .sort((left, right) => place(left.summary.account.id) - place(right.summary.account.id));
}

function homeServices(rows: ReturnType<typeof homeRows>, portfolio: Portfolio) {
  const pnlOf = new Map(portfolio.services.map((one) => [one.accountId, one]));
  const contributionOf = new Map(portfolio.contributions.map((row) => [row.accountId, row]));
  return rows.map(({ summary, colorIndex }) => {
    const measured = pnlOf.get(summary.account.id);
    const contribution = contributionOf.get(summary.account.id);
    return {
      ...listedOut(summary, colorIndex),
      pnl: measured ? servicePnlOut(measured) : null,
      contribution: contribution
        ? {
            pnl: money(contribution.cents),
            bar: round(contribution.bar),
            shareOfNet: ratio(contribution.shareOfNet),
          }
        : null,
    };
  });
}

function homePnl(portfolio: Portfolio) {
  return {
    status: portfolio.status,
    available: portfolio.available,
    parts: fullParts(portfolio.parts),
    transfers: money(portfolio.transfersCents),
    openPositions: portfolio.services.reduce((sum, one) => sum + one.openPositions, 0),
    modifiedDietz: ratio(portfolio.rate),
    rateReason: portfolio.rateReason,
    partial: portfolio.partial,
    stale: portfolio.stale,
    excluded: portfolio.excluded,
  };
}

/** What the portfolio holds today, by class, by service and by currency (§3.1, H6). */
function composition(home: HomeData, rows: ReturnType<typeof homeRows>) {
  const byCurrency = new Map<string, Cents>();
  for (const { summary } of rows) {
    if (summary.displayCents === null || summary.displayCents <= 0n) continue;
    const code = summary.account.currency;
    byCurrency.set(code, (byCurrency.get(code) ?? 0n) + summary.displayCents);
  }
  return {
    byClass: home.byClass.map((slice) => ({
      key: slice.key,
      value: money(slice.cents),
      share: round(slice.share),
    })),
    byService: slices(
      rows.map(({ summary }) => ({
        key: summary.account.id,
        name: summary.account.name,
        cents: summary.displayCents ?? 0n,
      })),
    ),
    byCurrency: slices([...byCurrency].map(([code, cents]) => ({ key: code, name: code, cents }))),
  };
}

/** The home of a period (§3.1): `home` is today's, `pnl` the period's, both the page's queries. */
export function homeOut(
  home: HomeData,
  pnl: View,
  funds: FundValues,
  parts: Pick<Home, "total" | "groups">,
): Home {
  const { portfolio, period, todayOn } = pnl;
  const rows = homeRows(home, pnl);
  return {
    on: todayOn,
    currency: pnl.currency,
    period: periodOut(pnl),
    totals: totalsJson(home.totals),
    valueAtEnd:
      period.to < todayOn ? maybe(sumCents(pnl.chart.map((one) => one.values.at(-1) ?? null)).total) : null,
    services: homeServices(rows, portfolio),
    pnl: homePnl(portfolio),
    chart: chartOut(pnl, portfolio.parts?.pnlCents ?? null, portfolio.rate),
    ...composition(home, rows),
    funds: {
      total: maybe(sumCents(funds.map((one) => one.valueCents)).total),
      rows: funds.map((one) => ({ id: one.fund.id, name: one.fund.name, value: maybe(one.valueCents) })),
    },
    ...parts,
  };
}

/** The service as its header, its tabs and its dialogs read it (§3.2): the sync's state only. */
function serviceHeaderOut(
  detail: ServiceDetail,
  colorIndex: number,
  firstOn: CivilDate | null,
  prices: ReadonlyMap<string, AssetPrice>,
) {
  const { summary, sync } = detail;
  const manual = summary.manualPnl;
  const option = (row: ServiceDetail["linkOptions"]["out"][number]) => ({
    id: row.id,
    on: row.on,
    amount: money(row.cents),
    payee: row.payee,
    accountName: row.accountName,
  });
  return {
    ...listedOut(summary, colorIndex),
    accountOrigin: summary.account.origin,
    url: summary.investment.url ?? summary.provider?.url ?? null,
    managedSince: summary.investment.managedSince,
    firstOn,
    // A manual service writes its value only on an account typed by hand, not one a provider reads.
    valueEditable: summary.investment.provider === "manual" && summary.account.origin === "manual",
    manualPnl:
      manual === null
        ? null
        : {
            value: maybe(manual.valueCents),
            invested: money(manual.investedCents),
            pnl: maybe(manual.pnlCents),
            rate: ratio(manual.rate),
            valuedOn: manual.valuedOn,
            stale: manual.stale,
            staleDays: STALE_VALUE_DAYS,
          },
    sync:
      sync === null
        ? null
        : {
            provider: sync.provider,
            providerName: investmentProviderName(sync.provider),
            connected: sync.connected,
            state: sync.state,
            lastOkAt: iso(sync.lastOkAt),
          },
    provider: sync === null ? null : connectableOut(sync.provider),
    assets: detail.assets.map((asset) => assetOut(asset, prices)),
    coveredProducts: detail.coveredProducts,
    linkOptions: { out: detail.linkOptions.out.map(option), in: detail.linkOptions.in.map(option) },
  };
}

/** A service's Overview (§3.3): `activity` is the first page of the period's events. */
export function overviewOut(
  detail: ServiceDetail,
  pnl: View,
  activity: ActivityData | null,
  prices: ReadonlyMap<string, AssetPrice>,
): Overview {
  const service = pnl.portfolio.services[0];
  const markers = pnl.intervals.map((interval) => {
    const flows = service.flows.filter((flow) => flow.on >= interval.from && flow.on <= interval.to);
    const into = flows.some((flow) => flow.cents > 0n);
    const out = flows.some((flow) => flow.cents < 0n);
    return into && out ? ("both" as const) : into ? ("in" as const) : out ? ("out" as const) : null;
  });
  const realized = realizedByEvent(service);
  return {
    on: pnl.todayOn,
    currency: pnl.currency,
    period: periodOut(pnl),
    service: serviceHeaderOut(detail, pnl.colorIndex.get(service.accountId) ?? 0, pnl.firstOn, prices),
    pnl: servicePnlOut(service),
    chart: {
      ...chartOut(pnl, service.display?.pnlCents ?? null, service.displayReturn?.dietz ?? null),
      markers,
    },
    contributions: contributionsOut(contributionsOf(service)),
    recent: (activity?.rows ?? []).slice(0, 5).map((row) => activityRowOut(row, realized)),
  };
}

/** A synced service's Activity (§3.5): a page of its events, and the sales' realized by month. */
export function activityOut(detail: ServiceDetail, pnl: View, activity: ActivityData): Activity {
  const service = pnl.portfolio.services[0];
  const realized = realizedByEvent(service);
  const realizedIn = (month: string) =>
    service.exits
      .filter((exit) => exit.on.startsWith(month) && exit.realizedCents !== null)
      .reduce<Cents>((sum, exit) => sum + exit.realizedCents!, 0n);
  return {
    source: "events",
    period: periodOut(pnl),
    page: activity.page,
    pages: activity.pages,
    total: activity.total,
    allTime: activity.allTime,
    counts: activity.counts,
    months: activity.months.map((row) => ({
      month: row.month,
      count: row.count,
      realized: money(realizedIn(row.month)),
    })),
    sums: {
      deposits: money(activity.sums.depositsCents),
      withdrawals: money(activity.sums.withdrawalsCents),
      fees: money(activity.sums.feesCents),
      net: money(activity.sums.depositsCents + activity.sums.withdrawalsCents),
    },
    first: activity.total === 0 ? 0 : (activity.page - 1) * ACTIVITY_PAGE_SIZE + 1,
    last: Math.min(activity.page * ACTIVITY_PAGE_SIZE, activity.total),
    rows: activity.rows.map((row) => activityRowOut(row, realized)),
    transferProposals: detail.transferProposals.map((row) => ({
      withdrawalId: row.withdrawalId,
      depositId: row.depositId,
      direction: row.direction,
      on: row.on,
      amount: money(row.amountCents),
      other: row.other,
    })),
  };
}

/** A manual service's Activity (PERS-342): the movements of its account in the period. */
export function movementsOut(pnl: View, movements: Movements): Activity {
  return {
    source: "movements",
    period: periodOut(pnl),
    rows: movements.rows.map((row) => ({
      id: row.id,
      on: row.on,
      payee: row.payee,
      amount: money(row.cents),
    })),
    deposits: money(movements.depositsCents),
    withdrawals: money(movements.withdrawalsCents),
    net: money(movements.depositsCents + movements.withdrawalsCents),
  };
}
