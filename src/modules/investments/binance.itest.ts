// Investments phase 4 (docs/design/investments.md §3.2, §5.2, §7 row "4 · ccxt"): Binance through
// the real source and mapping, on a fake exchange that answers with the spike's fixtures, against
// a real database — the strict credentials (SEC-03), the allowlist checked on every pass (B1), the
// windows of 90 days, events of the same millisecond, the cursor committed with the data (A7), and
// the opening inferred from 24 months of history (A6).
import { and, asc, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/platform/context";
import { addDays } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { saveRates } from "@/platform/fx/service";
import { binanceSource } from "@/platform/integrations/ccxt/source";
import type { BinanceApi } from "@/platform/integrations/ccxt/client";
import type { InvestmentSource } from "@/platform/integrations/investments/source";
import { providerLinks, syncJobs } from "@/platform/integrations/schema";
import { listConnections, listRuns } from "@/platform/integrations/service";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import {
  investmentAccountPeriods,
  investmentAccounts,
  investmentAssets,
  investmentEvents,
  investmentHoldings,
  investmentKeyChecks,
  investmentOperations,
  investmentReadingPositions,
  investmentReadings,
  investmentSyncCoverage,
} from "./schema";
import { connectInvestmentProvider, runInvestmentPass, setSourcesForTests } from "./sync";
import { NO_RATES } from "@/platform/fx/rules";
import { pnlOf, positionsOn, replayHoldings } from "./pnl";
import { investmentsPnl, serviceDetail, servicePnlView } from "./queries";
import { loadBook, ratesFor } from "./service";

const FIXTURES = join(process.cwd(), "test/fixtures/investments/binance");
const body = (name: string): unknown =>
  (JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown }).body;

const PROVIDER = "ccxt:binance";
const CANARY_KEY = "canary-binance-api-key-77d1";
const CANARY_SECRET = "canary-binance-secret-0b4e";
const KEYS = { api_key: CANARY_KEY, secret: CANARY_SECRET };
const NOW = new Date("2026-10-28T10:00:00Z");
const DAY = 86_400_000;
const MARKETS = [
  "ETH/EUR",
  "ETH/USDT",
  "EUR/USDT",
  "BNB/EUR",
  "TRX/USDT",
  "SUI/USDT",
  "USDC/EUR",
  "ATOM/USDT",
];

function contextFor(userId: string): Ctx {
  return {
    userId,
    role: "user",
    locale: "en",
    timeZone: "Europe/Rome",
    numberFormat: "it-IT",
    displayCurrency: "EUR",
  };
}

type Call = [string, ...unknown[]];
const within = (time: number, since: number, until: number) => time >= since && time <= until;

/** The spike's fixtures, answered window by window as Binance would. */
function fixtureExchange(calls: Call[], overrides: Partial<BinanceApi> = {}): BinanceApi {
  const transfers = (name: string) => (since: number, until: number) =>
    (body(name) as { timestamp: number }[]).filter((one) => within(one.timestamp, since, until));
  const base: BinanceApi = {
    apiRestrictions: async () => body("api-restrictions"),
    account: async () => body("account"),
    walletBalance: async () => body("wallet-balance"),
    fundingBalance: async () => (body("balance-funding") as { info: unknown }).info,
    earnFlexible: async () => body("earn-flexible-empty"),
    earnLocked: async () => body("earn-locked-empty"),
    markets: async () => MARKETS,
    tradeMarkets: async () => MARKETS,
    tickers: async () => ({
      ...(body("tickers") as object),
      "BNB/EUR": { last: 950, timestamp: NOW.getTime() },
      "TRX/USDT": { last: 0.3, timestamp: NOW.getTime() },
    }),
    // A flat market: every coin closes at 2 of its quote every day, EUR/USDT at 1.25.
    dailyCandles: async (symbol, since) =>
      Array.from({ length: 800 }, (_, index) => {
        const day = Math.floor(since / DAY) * DAY + index * DAY;
        return [day, 0, 0, 0, symbol === "EUR/USDT" ? 1.25 : 2, 0];
      }).filter((candle) => candle[0] <= NOW.getTime()),
    deposits: async (since, until) => transfers("deposits")(since, until),
    withdrawals: async (since, until) => transfers("withdrawals")(since, until),
    fiatOrders: async (type) => body(type === 0 ? "fiat-orders-deposits" : "fiat-orders-withdrawals"),
    fiatPayments: async () => body("fiat-payments-buy"),
    convertFlow: async (since, until) => {
      const all = body("convert-trade-flow") as { list: { createTime: string }[] };
      return { list: all.list.filter((one) => within(Number(one.createTime), since, until)) };
    },
    dividends: async (since, until) => {
      const all = body("asset-dividend") as { rows: { divTime: string }[] };
      return { rows: all.rows.filter((one) => within(Number(one.divTime), since, until)) };
    },
    dustLog: async () => ({ total: 0, userAssetDribblets: [] }),
    payTransactions: async () => ({ data: [] }),
    myTrades: async (symbol, fromId) =>
      (body("my-trades") as { symbol: string; info: { id: number } }[]).filter(
        (one) => one.symbol === symbol && one.info.id >= fromId,
      ),
  };
  const merged = { ...base, ...overrides };
  return Object.fromEntries(
    Object.entries(merged).map(([name, run]) => [
      name,
      async (...args: unknown[]) => {
        calls.push([name, ...args]);
        return (run as (...args: unknown[]) => Promise<unknown>)(...args);
      },
    ]),
  ) as unknown as BinanceApi;
}

let ctx: Ctx;
let calls: Call[];
let exchange: Partial<BinanceApi>;
let override: InvestmentSource | null;

beforeEach(async () => {
  await resetDatabase();
  ctx = contextFor((await createTestUser()).id);
  calls = [];
  exchange = {};
  override = null;
  setSourcesForTests((provider) =>
    provider === PROVIDER
      ? (override ??
        binanceSource(async (credentials) => {
          // SEC-03 at the boundary: the source only ever sees the two fields of the catalog.
          expect(Object.keys(credentials).sort()).toEqual(["api_key", "secret"]);
          return fixtureExchange(calls, exchange);
        }))
      : null,
  );
  const rates = [];
  for (let on = "2024-09-01"; on <= "2026-10-28"; on = addDays(on, 1)) {
    rates.push({ on, currency: "USD", eurPerUnit: "0.9" });
  }
  await saveRates(rates);
});

afterEach(() => {
  setSourcesForTests(null);
  vi.restoreAllMocks();
});

afterAll(async () => {
  await closeDatabase();
});

async function connectNew(credentials: Record<string, string> = KEYS) {
  return connectInvestmentProvider(
    ctx,
    PROVIDER,
    credentials,
    { kind: "new", name: "Binance", currency: "EUR" },
    NOW,
  );
}

async function pass(now: Date) {
  const [one] = await listConnections(ctx);
  return runInvestmentPass(
    { id: ctx.userId } as never,
    ctx,
    {
      id: one.id,
      userId: ctx.userId,
      provider: one.provider,
      schedule: one.schedule,
      nextSyncAt: one.nextSyncAt,
    },
    now,
  );
}

async function investmentOf(accountId: string) {
  const [investment] = await getDb()
    .select()
    .from(investmentAccounts)
    .where(eq(investmentAccounts.accountId, accountId));
  return investment;
}

async function eventsOf(accountId: string) {
  const investment = await investmentOf(accountId);
  return getDb()
    .select()
    .from(investmentEvents)
    .where(eq(investmentEvents.investmentAccountId, investment.id))
    .orderBy(asc(investmentEvents.occurredAt), asc(investmentEvents.id));
}

async function flowsCursor() {
  const [job] = await getDb().select().from(syncJobs).where(eq(syncJobs.kind, "flows"));
  return job?.cursor ?? null;
}

const named = (name: string) => calls.filter((call) => call[0] === name);

describe("connecting Binance (§5.1, SEC-03, B1)", () => {
  it("refuses a proxy in the credentials as invalid, before any call", async () => {
    await expect(connectNew({ ...KEYS, httpsProxy: "http://attacker.test:8080" })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
    expect(calls).toEqual([]);
    expect(await listConnections(ctx)).toEqual([]);
  });

  it("refuses a key with a flag it does not know switched on, and saves nothing", async () => {
    exchange.apiRestrictions = async () => ({
      ...(body("api-restrictions") as object),
      enableShinyNew: true,
    });
    await expect(connectNew()).rejects.toMatchObject({ code: "not_read_only" });
    expect(named("apiRestrictions")).toHaveLength(1);
    expect(named("account")).toEqual([]);
    expect(await listConnections(ctx)).toEqual([]);
    expect(await getDb().select().from(investmentAccounts)).toEqual([]);
  });

  it("saves the key, the reading with its prices, 24 months of flows and their cursor", async () => {
    const { accountId, ipRestricted } = await connectNew();
    // The dialog warns after connecting, and the service page shows its badge (PERS-87 SEC-02).
    expect(ipRestricted).toBe(false);
    expect((await serviceDetail(ctx, accountId))?.sync?.lastCheck?.ipRestricted).toBe(false);
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ provider: PROVIDER, state: "active" });
    const investment = await investmentOf(accountId);
    expect(investment).toMatchObject({ provider: PROVIDER, category: "crypto" });

    const [check] = await getDb().select().from(investmentKeyChecks);
    expect(check).toMatchObject({ result: "read-only", ipRestricted: false, provider: PROVIDER });
    expect(JSON.stringify(check)).not.toContain(CANARY_KEY);

    const [reading] = await getDb()
      .select()
      .from(investmentReadings)
      .where(eq(investmentReadings.on, "2026-10-28"));
    // ETHW has no market: dust, not a missing price (PERS-100).
    expect(reading).toMatchObject({ status: "complete", totalCents: 2n, missingPrices: 0 });
    const positions = await getDb()
      .select({
        symbol: investmentAssets.symbol,
        product: investmentReadingPositions.product,
        value: investmentReadingPositions.valueCents,
        fxSource: investmentReadingPositions.fxSource,
      })
      .from(investmentReadingPositions)
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentReadingPositions.assetId))
      .orderBy(asc(investmentAssets.symbol));
    expect(positions).toEqual([
      { symbol: "BNB", product: "spot", value: 2n, fxSource: null },
      { symbol: "ETHW", product: "funding", value: null, fxSource: null },
      { symbol: "TRX", product: "spot", value: 0n, fxSource: "exchange:EUR/USDT@2026-10-27T22:52:46.431Z" },
    ]);

    // B7: 24 months of crypto deposits in windows of 90 days.
    const deposits = named("deposits");
    expect(deposits).toHaveLength(9);
    for (const call of deposits) expect((call[2] as number) - (call[1] as number)).toBeLessThan(90 * DAY);

    const events = await eventsOf(accountId);
    const links = await getDb()
      .select({ externalId: providerLinks.externalId })
      .from(providerLinks)
      .where(eq(providerLinks.provider, PROVIDER));
    const ids = links.map((one) => one.externalId);
    expect(ids).toEqual(
      expect.arrayContaining([
        "deposit:fixture-id-0033",
        "withdrawal:fixture-id-0043",
        "fiat:fixture-id-0051",
        "card:fixture-id-0055",
        "convert:fixture-id-0057",
        "dividend:fixture-id-0062",
        "trade:ETHEUR:900076",
        "trade:ETHUSDT:900072",
      ]),
    );
    expect(events.length).toBe(links.length);

    const cursor = await flowsCursor();
    expect(cursor).toMatchObject({
      from: new Date(NOW.getTime() - 730 * DAY).toISOString(),
      deposits: NOW.toISOString(),
    });
    expect(cursor?.["trades:ETH/USDT"]).toBe("900080");

    const coverage = await getDb()
      .select()
      .from(investmentSyncCoverage)
      .orderBy(asc(investmentSyncCoverage.stream), asc(investmentSyncCoverage.fromAt));
    const streams = new Set(coverage.map((one) => one.stream));
    for (const stream of [
      "deposits",
      "withdrawals",
      "fiat_orders",
      "fiat_payments",
      "convert",
      "dividends",
      "dust",
      "pay",
      "trades",
      "quantities",
    ]) {
      expect(streams).toContain(stream);
    }
    expect(coverage.filter((one) => one.reason === "api_limit_24m")).toHaveLength(8);
    expect(coverage.filter((one) => one.reason === "api_limit_18m").map((one) => one.stream)).toEqual([
      "pay",
    ]);
  });

  it("values a trade's fee in BNB at the day's close, in cents and not rounded to zero", async () => {
    const { accountId } = await connectNew();
    const [link] = await getDb()
      .select({ entityId: providerLinks.entityId })
      .from(providerLinks)
      .where(eq(providerLinks.externalId, "trade:ETHEUR:900076"));
    const legs = await getDb()
      .select()
      .from(investmentOperations)
      .where(eq(investmentOperations.eventId, link.entityId))
      .orderBy(asc(investmentOperations.leg));
    expect(legs.map((one) => [one.leg, one.kind, one.amountCents])).toEqual([
      ["base", "buy", -11_094n],
      ["fee", "fee", 0n],
    ]);
    // 0.00010539 BNB × 2 € = 0.0002 €: the amount is honest (0), the rate and its source are kept.
    expect(legs[1]).toMatchObject({
      fxSource: "exchange:BNB/EUR@2026-01-03",
      quantity: "0.000105390000000000",
    });
    expect(accountId).toBeTruthy();
  });

  it("infers the opening of every coin at the start of the history, and checks the quantities (A6)", async () => {
    const { accountId } = await connectNew();
    const investment = await investmentOf(accountId);
    const openings = await getDb()
      .select({
        symbol: investmentAssets.symbol,
        quantity: investmentOperations.quantity,
        basis: investmentOperations.quantityBasis,
        on: investmentEvents.on,
      })
      .from(investmentOperations)
      .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
      .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
      .where(
        and(
          eq(investmentEvents.investmentAccountId, investment.id),
          eq(investmentOperations.kind, "opening_position"),
        ),
      )
      .orderBy(asc(investmentAssets.symbol));
    expect(openings.every((one) => one.basis === "inferred")).toBe(true);
    expect(openings.every((one) => one.on === "2024-10-28")).toBe(true);
    // ETH held nothing today: the opening is what the 24 months took out of it.
    const eth = openings.find((one) => one.symbol === "ETH");
    expect(Number(eth?.quantity)).toBeCloseTo(
      0.24346 + 0.0014324 + 0.000074 - 0.00403781 - 0.041625 - 0.00037 - 0.0015064 - 0.00000012,
      12,
    );
    // For every coin with an opening, opening + Σ legs = the quantity reported (0 for ETH).
    const legs = await getDb()
      .select({
        symbol: investmentAssets.symbol,
        kind: investmentOperations.kind,
        quantity: investmentOperations.quantity,
      })
      .from(investmentOperations)
      .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
      .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
      .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
      .where(eq(investmentEvents.investmentAccountId, investment.id));
    const sign = (kind: string) => (["opening_position", "deposit", "buy", "income"].includes(kind) ? 1 : -1);
    const ethTotal = legs
      .filter((one) => one.symbol === "ETH" && one.quantity !== null)
      .reduce((sum, one) => sum + sign(one.kind) * Number(one.quantity), 0);
    expect(ethTotal).toBeCloseTo(0, 12);
    // XRP came in and the fixtures do not say where it went: a declared gap, never a silent one.
    const [quantities] = await getDb()
      .select()
      .from(investmentSyncCoverage)
      .where(eq(investmentSyncCoverage.stream, "quantities"));
    expect(quantities).toMatchObject({ status: "partial", reason: "negative_opening" });
    expect(openings.some((one) => one.symbol === "XRP")).toBe(false);
  });
});

describe("the Binance pass (§3.1, A7)", () => {
  it("reads again from 24 hours before the cursor, and writes each event once", async () => {
    const { accountId } = await connectNew();
    const before = (await eventsOf(accountId)).length;
    calls = [];
    const later = new Date(NOW.getTime() + 12 * 3_600_000);
    expect(await pass(later)).toBe("answered");
    const deposits = named("deposits");
    expect(deposits).toEqual([["deposits", NOW.getTime() - DAY, later.getTime()]]);
    expect(named("myTrades")).toContainEqual(["myTrades", "ETH/USDT", 900_080]);
    expect((await eventsOf(accountId)).length).toBe(before);
    expect((await flowsCursor())?.deposits).toBe(later.toISOString());
  });

  it("keeps two rewards of the same millisecond as two events", async () => {
    const at = String(NOW.getTime() - 2 * DAY);
    exchange.dividends = async (since, until) => ({
      rows: within(Number(at), since, until)
        ? [
            { id: "same-1", asset: "BNB", amount: "0.001", divTime: at, enInfo: "BNB Vault" },
            { id: "same-2", asset: "BNB", amount: "0.001", divTime: at, enInfo: "BNB Vault" },
          ]
        : [],
    });
    const { accountId } = await connectNew();
    await pass(new Date(NOW.getTime() + 3_600_000));
    const notes = (await eventsOf(accountId)).filter((one) => one.note === "BNB Vault");
    expect(notes).toHaveLength(2);
    expect(new Set(notes.map((one) => one.occurredAt.getTime())).size).toBe(1);
  });

  it("commits the cursor with the data: a write that fails moves neither (A7)", async () => {
    const { accountId } = await connectNew();
    const cursor = await flowsCursor();
    const events = (await eventsOf(accountId)).length;
    const real = binanceSource(async () => fixtureExchange(calls, exchange));
    override = {
      ...real,
      async fetchFlows(credentials, now, options) {
        const read = await real.fetchFlows(credentials, now, options);
        // A leg the database refuses (a negative quantity), after events it would accept.
        const broken = structuredClone(read.events[0]);
        broken.externalId = "deposit:broken";
        broken.legs[0].quantity = "-1";
        return {
          ...read,
          events: [{ ...read.events[1], externalId: "deposit:fine" }, broken],
          cursor: { ...read.cursor, deposits: "2030-01-01T00:00:00.000Z" },
        };
      },
    };
    expect(await pass(new Date(NOW.getTime() + 3_600_000))).toBe("failed");
    expect(await flowsCursor()).toEqual(cursor);
    expect((await eventsOf(accountId)).length).toBe(events);
    const runs = await listRuns(ctx, { limit: 2 });
    expect(runs.map((run) => [run.kind, run.state]).sort()).toEqual([
      ["flows", "failed"],
      ["holdings", "success"],
    ]);
  });

  it("is refused when the key starts to write during a pass, and reads nothing (§5.2, SEC-01)", async () => {
    const { accountId } = await connectNew();
    const readings = await getDb()
      .select()
      .from(investmentReadings)
      .where(eq(investmentReadings.investmentAccountId, (await investmentOf(accountId)).id));
    calls = [];
    exchange.apiRestrictions = async () => ({
      ...(body("api-restrictions") as object),
      enableWithdrawals: true,
    });
    expect(await pass(new Date(NOW.getTime() + 86_400_000))).toBe("refused");
    expect(calls.map((call) => call[0])).toEqual(["apiRestrictions"]);
    expect(
      await getDb()
        .select()
        .from(investmentReadings)
        .where(eq(investmentReadings.investmentAccountId, (await investmentOf(accountId)).id)),
    ).toEqual(readings);
    const [connection] = await listConnections(ctx);
    expect(connection).toMatchObject({ state: "error", lastError: "ccxt:binance · key_write" });
    const checks = await getDb()
      .select()
      .from(investmentKeyChecks)
      .orderBy(asc(investmentKeyChecks.checkedAt));
    expect(checks.at(-1)).toMatchObject({ origin: "pass", result: "write" });
    expect((checks.at(-1)?.permissions as Record<string, boolean>).enableWithdrawals).toBe(true);
  });

  it("never lets the key or the secret reach an error, a run or the console (§5.1)", async () => {
    await connectNew();
    const logged: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    exchange.account = async () => {
      throw new Error(
        `GET https://api.binance.com/api/v3/account?signature=x&key=${CANARY_KEY}&s=${CANARY_SECRET}`,
      );
    };
    expect(await pass(new Date(NOW.getTime() + 86_400_000))).toBe("failed");
    const [connection] = await listConnections(ctx);
    const runs = await listRuns(ctx, { limit: 5 });
    const text = JSON.stringify([connection, runs, logged]);
    expect(text).not.toContain(CANARY_KEY);
    expect(text).not.toContain(CANARY_SECRET);
    expect(text).not.toContain("signature");
  });
});

describe("the estimated history (PERS-100)", () => {
  async function estimatedOf(accountId: string) {
    const investment = await investmentOf(accountId);
    return getDb()
      .select()
      .from(investmentReadings)
      .where(
        and(
          eq(investmentReadings.investmentAccountId, investment.id),
          eq(investmentReadings.status, "estimated"),
        ),
      )
      .orderBy(asc(investmentReadings.on));
  }

  it("rebuilds every day of the 24 months from the flows and the daily closes, and says so", async () => {
    const { accountId } = await connectNew();
    const estimated = await estimatedOf(accountId);
    expect(estimated[0].on).toBe("2024-10-28");
    expect(estimated.at(-1)?.on).toBe("2026-10-27");
    expect(estimated).toHaveLength(730);
    // A flat market of 2 per coin: some day of the history held something.
    expect(estimated.some((day) => day.totalCents > 0n)).toBe(true);

    // The opening period starts with the history, and so does the service.
    const investment = await investmentOf(accountId);
    expect(investment).toMatchObject({ managedSince: "2024-10-28", openedOn: "2024-10-28" });
    const periods = await getDb()
      .select()
      .from(investmentAccountPeriods)
      .where(eq(investmentAccountPeriods.investmentAccountId, investment.id));
    expect(periods.map((period) => [period.fromOn, period.reason])).toEqual([["2024-10-28", "opening"]]);
    const [coverage] = await getDb()
      .select()
      .from(investmentSyncCoverage)
      .where(eq(investmentSyncCoverage.stream, "balance_history"));
    expect(coverage).toMatchObject({ kind: "holdings", status: "partial", reason: "estimated" });

    // The chart: the history is drawn, dashed up to the first real reading.
    const view = await servicePnlView(ctx, accountId, { period: "all" }, NOW);
    const series = view!.chart[0];
    expect(series.values.every((value) => value !== null)).toBe(true);
    expect(series.valuesEstimated.slice(0, -1).every(Boolean)).toBe(true);
    expect(series.valuesEstimated.at(-1)).toBe(false);
    // Today's value is the reading's, untouched.
    expect(series.values.at(-1)).toBe(2n);
  });

  it("estimates once: the next pass writes no day twice and keeps the real reading", async () => {
    const { accountId } = await connectNew();
    const before = await estimatedOf(accountId);
    await pass(new Date(NOW.getTime() + DAY));
    const after = await estimatedOf(accountId);
    expect(after.map((day) => [day.on, day.totalCents])).toEqual(
      before.map((day) => [day.on, day.totalCents]),
    );
    const real = await getDb()
      .select({ on: investmentReadings.on, status: investmentReadings.status })
      .from(investmentReadings)
      .where(eq(investmentReadings.on, "2026-10-28"));
    expect(real).toEqual([{ on: "2026-10-28", status: "complete" }]);
  });

  it("leaves the history to the next pass when the closes cannot be read", async () => {
    exchange.dailyCandles = async () => {
      throw new Error("down");
    };
    const { accountId } = await connectNew();
    expect(await estimatedOf(accountId)).toEqual([]);
    const investment = await investmentOf(accountId);
    expect(investment.managedSince).toBe("2026-10-28");
  });
});

describe("a history read again with more streams (PERS-141)", () => {
  it("infers the openings and estimates the history again, once, from the complete flows", async () => {
    const { accountId } = await connectNew();
    const investment = await investmentOf(accountId);
    const ethOpening = async () =>
      getDb()
        .select({ eventId: investmentEvents.id, quantity: investmentOperations.quantity })
        .from(investmentOperations)
        .innerJoin(investmentEvents, eq(investmentEvents.id, investmentOperations.eventId))
        .innerJoin(investmentHoldings, eq(investmentHoldings.id, investmentOperations.holdingId))
        .innerJoin(investmentAssets, eq(investmentAssets.id, investmentHoldings.assetId))
        .where(
          and(
            eq(investmentEvents.investmentAccountId, investment.id),
            eq(investmentOperations.kind, "opening_position"),
            eq(investmentAssets.symbol, "ETH"),
          ),
        );
    const dayBefore = async () =>
      (
        await getDb()
          .select({ totalCents: investmentReadings.totalCents })
          .from(investmentReadings)
          .where(
            and(
              eq(investmentReadings.investmentAccountId, investment.id),
              eq(investmentReadings.on, "2025-01-09"),
            ),
          )
      )[0]?.totalCents;
    const [before] = await ethOpening();
    const valueBefore = await dayBefore();
    expect(valueBefore).toBeDefined();

    // A history started before the dust log: the cursor of the older source, and 1 ETH sold to dust.
    const [job] = await getDb().select().from(syncJobs).where(eq(syncJobs.kind, "flows"));
    const older = Object.fromEntries(
      Object.entries(job.cursor ?? {}).filter(
        ([key]) => !["history", "pay_from", "dust", "pay"].includes(key),
      ),
    );
    await getDb().update(syncJobs).set({ cursor: older }).where(eq(syncJobs.id, job.id));
    exchange.dustLog = async (since, until) => {
      const at = Date.parse("2025-01-10T12:00:00Z");
      if (at < since || at > until) return { userAssetDribblets: [] };
      return {
        userAssetDribblets: [
          {
            userAssetDribbletDetails: [
              {
                transId: 41,
                fromAsset: "ETH",
                amount: "1",
                transferedAmount: "0.01",
                serviceChargeAmount: "0.0002",
                operateTime: at,
              },
            ],
          },
        ],
      };
    };
    await pass(new Date(NOW.getTime() + DAY));

    // One ETH opening, inferred again: it now holds the coin the dust took.
    const after = await ethOpening();
    expect(after).toHaveLength(1);
    expect(after[0].eventId).not.toBe(before.eventId);
    expect(Number(after[0].quantity)).toBeCloseTo(Number(before.quantity) + 1, 12);
    const links = await getDb()
      .select({ externalId: providerLinks.externalId })
      .from(providerLinks)
      .where(eq(providerLinks.externalId, "opening:ETH"));
    expect(links).toHaveLength(1);
    // The estimated history stands on the new flows: the day before held that ETH, at 2 a coin.
    expect((await dayBefore())! - valueBefore!).toBeGreaterThanOrEqual(150n);
    expect(await flowsCursor()).toMatchObject({ history: "2" });

    // Once: the next pass infers nothing again.
    await pass(new Date(NOW.getTime() + 2 * DAY));
    expect((await ethOpening()).map((one) => one.eventId)).toEqual([after[0].eventId]);
  });
});

describe("the P&L of a period on Binance (docs/design/investments-ux.md §4.4, U1)", () => {
  it("counts a fee paid in BNB once, as a fee at the day's close and as a sale of the BNB", async () => {
    const { accountId } = await connectNew();
    const [link] = await getDb()
      .select({ entityId: providerLinks.entityId })
      .from(providerLinks)
      .where(eq(providerLinks.externalId, "trade:ETHEUR:900076"));
    const legs = await getDb()
      .select()
      .from(investmentOperations)
      .where(eq(investmentOperations.eventId, link.entityId));
    const fee = legs.find((one) => one.kind === "fee")!;
    const base = legs.find((one) => one.kind === "buy")!;

    // The engine on the book Binance wrote, every flow taken as known.
    const investment = await investmentOf(accountId);
    const book = await loadBook(ctx, investment, "EUR");
    const rates = await ratesFor(book, "2026-10-28");
    const pnl = pnlOf(
      {
        accountId,
        currency: "EUR",
        book,
        rates,
        coverage: null,
        quantityMismatch: false,
        externalIds: new Map(),
      },
      null,
      "2026-10-28",
      { currency: "EUR", rates: NO_RATES },
    );
    // The fee leaves the BNB holding at its value of the day; the ETH costs its quote only.
    const exit = pnl.exits.find((one) => one.eventId === link.entityId);
    expect(exit).toMatchObject({ kind: "fee", holdingId: fee.holdingId, proceedsCents: -fee.amountCents });
    expect(pnl.exits.some((one) => one.holdingId === base.holdingId && one.eventId === link.entityId)).toBe(
      false,
    );
    const { costs } = replayHoldings(book, "2026-01-03");
    expect(costs.get(base.holdingId!)?.costCents).toBeGreaterThanOrEqual(-base.amountCents);
    // The fees of the period are every fee leg, the BNB ones included, once.
    const fees = await getDb()
      .select()
      .from(investmentOperations)
      .where(eq(investmentOperations.kind, "fee"));
    expect(pnl.local?.feesCents).toBe(fees.reduce((sum, one) => sum + one.amountCents, 0n));
    const parts = pnl.local!;
    expect(
      parts.realizedCents +
        (parts.unrealizedChangeCents ?? 0n) +
        parts.incomeCents +
        parts.feesCents +
        parts.correctionsCents +
        parts.unattributedCents,
    ).toBe(parts.pnlCents);
  });

  it("takes a coin's cost from its trades when they add up to the quantity read (§4.7, U4)", async () => {
    const { accountId } = await connectNew();
    const investment = await investmentOf(accountId);
    const book = await loadBook(ctx, investment, "EUR");
    const rates = await ratesFor(book, "2026-10-28");
    const replay = replayHoldings(book, "2026-10-28");
    const { kind, positions } = positionsOn(book, "2026-10-28", rates, replay);
    expect(kind).toBe("positions");
    expect(positions.length).toBeGreaterThan(0);
    for (const one of positions) {
      const replayed = one.holdingId === null ? undefined : replay.costs.get(one.holdingId);
      const adds =
        replayed?.quantity != null &&
        one.quantity !== null &&
        (replayed.quantity > one.quantity
          ? replayed.quantity - one.quantity
          : one.quantity - replayed.quantity) *
          1_000_000n <=
          one.quantity;
      if (adds) expect(one).toMatchObject({ costSource: "events", costCents: replayed!.costCents });
      // Binance gives no cost of its own: what the trades do not explain has none, never a guess.
      else expect(one).toMatchObject({ costSource: null, costCents: null, unrealizedCents: null });
    }
    expect(positions.some((one) => one.costSource === "events")).toBe(true);
  });

  it("does not stand a P&L on a rebuilt history whose quantities do not add up (§4.6)", async () => {
    const { accountId } = await connectNew();
    const [quantities] = await getDb()
      .select()
      .from(investmentSyncCoverage)
      .where(eq(investmentSyncCoverage.stream, "quantities"));
    expect(quantities).toMatchObject({ status: "partial", reason: "negative_opening" });
    const { portfolio } = await investmentsPnl(ctx, { period: "2026" }, NOW);
    const pnl = portfolio.services.find((one) => one.accountId === accountId)!;
    // The first real reading is today's: nothing of 2026 stands on a trusted base yet.
    expect(pnl).toMatchObject({ status: "undetermined", local: null });
    expect(pnl.reasons).toContain("quantity_mismatch");
    expect(portfolio).toMatchObject({ status: "undetermined", excluded: [{ accountId }] });
  });
});
