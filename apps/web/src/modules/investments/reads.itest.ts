// R3 parity of the reads of Investments: every field the routes added for the pages is the figure the
// page shows today, computed here as the page computes it (the lines of `app/(app)/investments/page.tsx`,
// `[accountId]/page.tsx` and the tabs, copied), on the reference user's manual broker and a synced
// service a fake provider reads (an open position, cash, a deposit, coverage from before its cut-off),
// for «all», a year and a custom period.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@domain/platform/context";
import type { HoldingsSnapshot, InvestmentSource } from "@domain/platform/integrations/investments/source";
import { addDays, civilDateIn } from "@domain/shared/dates";
import { closeDatabase, resetDatabase } from "../../../../../test/db";
import { newContext } from "../../../../../test/fixtures";
import { connectTarget } from "../../../../../test/investments";
import { REFERENCE_NOW, seedReferenceUser } from "../../../../../test/reference-user";

vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

const { adapters } = await import("@/app/api/v1/[[...route]]/composition");
const { apiRoutes } = await import("@ledgerly/api");
const investments = await import("@ledgerly/domain/investments");
const { connectInvestmentProvider, setSourcesForTests } = await import("@domain/modules/investments/sync");
const { centsToDecimal } = await import("@ledgerly/domain/shared/money");
const { asReturns, returnScale, runningTotal } = await import("@ledgerly/ui/chart-data");

type Cents = bigint;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the answers are read as JSON
type Json = any;

const TODAY = "2031-10-15";
const PERIODS = [
  { period: "all" },
  { period: "2031" },
  { period: "custom", from: "2031-02-01", to: "2031-08-31" },
] as const;

let ctx: Ctx;
let brokerId: string;
let syncedId: string;

const routes = apiRoutes({
  ...adapters,
  guard: () => async (context, next) => {
    context.set("ctx", ctx);
    await next();
  },
});

async function get(path: string): Promise<Json> {
  const response = await routes.request(path);
  expect(response.status, path).toBe(200);
  return response.json();
}

const dec = (cents: Cents | null | undefined) =>
  cents === null || cents === undefined ? null : centsToDecimal(cents);
/** The serializer's ratios: 6 decimals. */
const six = (value: number | null) => (value === null ? null : Number(value.toFixed(6)));
const query = (one: (typeof PERIODS)[number]) => new URLSearchParams(one).toString();
const pagePeriod = (one: (typeof PERIODS)[number]) =>
  investments.sectionPeriod(investments.legacyPeriodQuery(one as Json, TODAY) ?? (one as Json), TODAY).period;

/** A broker with a stock, cash and a deposit, and coverage that starts years before its cut-off. */
function fakeSource(): InvestmentSource {
  return {
    async verifyReadOnly() {
      return { result: "read-only", permissions: {}, ipRestricted: null, externalAccountId: "ext-parity" };
    },
    async fetchHoldings(): Promise<HoldingsSnapshot> {
      return {
        observedAt: new Date(),
        externalAccountId: "ext-parity",
        totalCents: 150_000n,
        cashCents: 50_000n,
        positions: [
          {
            asset: { externalId: "inst-1", class: "stock", name: "Stock A", symbol: "STKA", currency: "EUR" },
            product: "trading",
            quantity: "5",
            price: "200",
            priceCurrency: "EUR",
            priceSource: "etoro",
            valueCents: 100_000n,
          },
        ],
        scopes: [
          { product: "cash", complete: true },
          { product: "copy", complete: true },
          { product: "trading", complete: true },
        ],
        empty: false,
        complete: true,
      };
    },
    async fetchFlows(_credentials, now) {
      return {
        events: [
          {
            externalId: "dep-1",
            occurredAt: new Date(now.getTime() - 100 * 86_400_000),
            note: null,
            legs: [
              {
                leg: "main",
                kind: "deposit",
                asset: null,
                product: null,
                quantity: null,
                unitPrice: null,
                priceCurrency: null,
                nativeAmount: "1000",
                nativeCurrency: "EUR",
              },
            ],
          },
        ],
        coverage: [
          {
            stream: "deposits",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "complete",
            reason: null,
          },
        ],
      };
    },
    async fetchHistory(_credentials, _currency, now) {
      const first = new Date(now.getTime() - 360 * 86_400_000).toISOString().slice(0, 10);
      return {
        points: [{ on: first, totalCents: 0n }],
        coverage: [
          {
            stream: "balance_history",
            fromAt: new Date("2020-01-01T00:00:00Z"),
            toAt: now,
            status: "gap",
            reason: "api_limit_12m",
          },
        ],
      };
    },
  };
}

beforeAll(async () => {
  await resetDatabase();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(REFERENCE_NOW);
  ctx = await newContext();
  ({ brokerId } = await seedReferenceUser(ctx, (instant) => vi.setSystemTime(instant)));
  vi.setSystemTime(REFERENCE_NOW);
  setSourcesForTests(() => fakeSource());
  ({ accountId: syncedId } = await connectInvestmentProvider(
    ctx,
    "etoro",
    { api_key: "parity-api-key", user_key: "parity-user-key" },
    await connectTarget(ctx, { name: "Broker S", category: "broker", currency: "EUR" }),
  ));
}, 120_000);

afterAll(async () => {
  setSourcesForTests(null);
  vi.useRealTimers();
  await resetDatabase();
  await closeDatabase();
});

/** The Return view as the pages draw it: the bars and their running total over the hero's P&L and rate. */
function expectReturns(
  chart: Json,
  bars: readonly (Cents | null)[],
  total: Cents | null,
  rate: number | null,
) {
  const scale = returnScale(total, rate);
  const shares = scale === null ? bars.map(() => null) : asReturns(bars, scale);
  const cumulative = scale === null ? bars.map(() => null) : asReturns(runningTotal(bars), scale);
  expect(chart.returns).toEqual(shares.map(six));
  expect(chart.cumulativeReturns).toEqual(cumulative.map(six));
}

describe.each(PERIODS)("the reads of Investments, period %o", (one) => {
  it("home: fees and exchange, and the Return view", async () => {
    const answer = await get(`/investments/home?${query(one)}`);
    const snapshot = await investments.investmentsSnapshot(ctx);
    const pnl = await investments.investmentsPnlView(ctx, pagePeriod(one), snapshot);
    const parts = pnl.portfolio.parts;
    expect(parts).not.toBeNull();
    expect(answer.pnl.parts.feesAndFx).toBe(dec(parts!.feesCents + parts!.fxCents));
    const barTotals = pnl.intervals.map((_, index) => {
      const known = pnl.chart.map((service) => service.bars[index]).filter((cents) => cents !== null);
      return known.length === 0 ? null : known.reduce<Cents>((sum, cents) => sum + cents!, 0n);
    });
    expectReturns(answer.chart, barTotals, parts?.pnlCents ?? null, pnl.portfolio.rate);
  });

  it.each([
    ["the manual broker", () => brokerId],
    ["the synced service", () => syncedId],
  ])("Overview of %s: the bridge, the Return view, the staleness of a typed value", async (_name, idOf) => {
    const accountId = idOf();
    const answer = await get(`/investments/${accountId}?${query(one)}`);
    const snapshot = await investments.investmentsSnapshot(ctx, { accountId });
    const pnl = (await investments.servicePnlView(ctx, accountId, pagePeriod(one), snapshot))!;
    const service = pnl.portfolio.services[0];
    expect(answer.pnl.display.beforeFx).toBe(dec(service.display!.pnlCents - service.display!.fxCents));
    expectReturns(
      answer.chart,
      pnl.chart[0]?.bars ?? [],
      service.display?.pnlCents ?? null,
      service.displayReturn?.dietz ?? null,
    );
    if (accountId === brokerId) expect(answer.service.manualPnl.staleDays).toBe(investments.STALE_VALUE_DAYS);
    else expect(answer.service.manualPnl).toBeNull();
  });

  it("Positions: the total row's P&L, the cash's share, the day the positions start", async () => {
    const answer = await get(`/investments/${syncedId}/positions?${query(one)}`);
    const snapshot = await investments.investmentsSnapshot(ctx, { accountId: syncedId });
    const view = (await investments.servicePositions(ctx, syncedId, pagePeriod(one), snapshot))!;
    const { service } = view;
    const open = service.holdings.filter((row) => row.end !== null);
    const shownCash =
      service.endCashCents !== null && service.endCashCents !== 0n ? service.endCashCents : null;
    const openTotal = open.reduce((sum, row) => sum + (row.end!.valueCents ?? 0n), 0n) + (shownCash ?? 0n);
    const share = (cents: Cents | null) =>
      cents === null || openTotal <= 0n ? null : Number(cents) / Number(openTotal);
    expect(answer.open.pnl).toBe(dec(open.reduce((sum, row) => sum + (row.contributionCents ?? 0n), 0n)));
    expect(answer.open.cashShare).toBe(six(share(shownCash)));
    expect(answer.startOn).toBe(service.from === null ? null : addDays(service.from, -1));
  });

  it("Activity: net, and the rows of the page", async () => {
    const events = await get(`/investments/${syncedId}/activity?${query(one)}`);
    const snapshot = await investments.investmentsSnapshot(ctx, { accountId: syncedId });
    const pnl = (await investments.servicePnlView(ctx, syncedId, pagePeriod(one), snapshot))!;
    const activity = (await investments.serviceActivity(ctx, syncedId, {
      from: pnl.span.from,
      to: pnl.span.to,
      family: null,
      q: null,
      assetId: null,
      page: 1,
    }))!;
    expect(events.source).toBe("events");
    expect(events.sums.net).toBe(dec(activity.sums.depositsCents + activity.sums.withdrawalsCents));
    expect(events.first).toBe(
      activity.total === 0 ? 0 : (activity.page - 1) * investments.ACTIVITY_PAGE_SIZE + 1,
    );
    expect(events.last).toBe(Math.min(activity.page * investments.ACTIVITY_PAGE_SIZE, activity.total));

    const manual = await get(`/investments/${brokerId}/activity?${query(one)}`);
    const brokerPnl = (await investments.servicePnlView(
      ctx,
      brokerId,
      pagePeriod(one),
      await investments.investmentsSnapshot(ctx, { accountId: brokerId }),
    ))!;
    const movements = (await investments.serviceMovements(ctx, brokerId, brokerPnl.span))!;
    expect(manual.source).toBe("movements");
    expect(manual.net).toBe(dec(movements.depositsCents + movements.withdrawalsCents));
  });
});

describe("the read of Connection", () => {
  it("lists the coverage on the days the service reads, and where the activity starts", async () => {
    const answer = await get(`/investments/${syncedId}/connection`);
    const detail = (await investments.serviceDetail(ctx, syncedId))!;
    const dayOf = (at: Date) => civilDateIn(at, ctx.timeZone);
    const sinceOn = detail.summary.investment.managedSince;
    const since = new Date(`${sinceOn}T00:00:00Z`);
    const coverage = detail
      .sync!.coverage.filter((row) => dayOf(row.toAt) > sinceOn)
      .map((row) => (dayOf(row.fromAt) < sinceOn ? { ...row, fromAt: since } : row));
    const flows = coverage.filter(
      (row) => row.kind === "flows" && row.stream !== "quantities" && row.stream !== "balance_history",
    );
    const completeFrom = flows.length === 0 ? null : flows.map((row) => dayOf(row.fromAt)).sort()[0];
    // The data is worth checking: a window starts before the cut-off and is cut there.
    expect(detail.sync!.coverage.some((row) => dayOf(row.fromAt) < sinceOn)).toBe(true);
    expect(answer.sync.visibleCoverage).toEqual(
      coverage.map((row) => ({
        kind: row.kind,
        stream: row.stream,
        from: row.fromAt.toISOString(),
        to: row.toAt.toISOString(),
        status: row.status,
        reason: row.reason,
      })),
    );
    expect(answer.sync.activityFrom).toBe(completeFrom);
    expect(completeFrom).not.toBeNull();
  });
});
