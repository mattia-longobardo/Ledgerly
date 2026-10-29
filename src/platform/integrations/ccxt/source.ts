/**
 * Binance as an {@link InvestmentSource} (docs/design/investments.md §3.2, D18): the client's calls
 * in the order a pass makes them, mapped by `binance.ts`. No database; the only state is the
 * cursor the module saves with the events it read (A7).
 *
 * Cursor keys: `from` (the start of the history, fixed at the first pass), one time per stream
 * (`deposits`, `fiat_orders:0`, …: the next pass reads again from 24 hours before it), one trade id
 * per market (`trades:ETH/EUR`: the next pass starts at it, inclusive), and `assets`, every coin
 * ever seen, so a market found once is followed for good (B3).
 */
import { addDays, type CivilDate, civilDateIn } from "@/platform/dates";
import {
  type FlowCursor,
  type FxLookup,
  type InvestmentSource,
  type ProviderEvent,
  SourceError,
} from "../investments/source";
import {
  BINANCE_PROVIDER,
  type BalancesRead,
  balancesOf,
  binanceCoverage,
  candleSymbols,
  closesOf,
  dailyRate,
  decimal,
  convertEventsOf,
  dividendEventsOf,
  dustEventsOf,
  earnRewardEventsOf,
  type EarnPage,
  PAY_HISTORY_DAYS,
  payEventsOf,
  earnPageOf,
  FLOW_STREAMS,
  fiatOrderEventsOf,
  fiatPaymentEventsOf,
  HISTORY_DAYS,
  historyStart,
  holdingsOf,
  isFiat,
  keyCheckOf,
  OVERLAP_MS,
  priceLegs,
  quotesOf,
  type StreamRows,
  tickerSymbols,
  tradeEventsOf,
  tradeSymbols,
  transferEventsOf,
  windowsOf,
} from "./binance";
import { type BinanceApi, binanceApi } from "./client";

/**
 * What the flows read (PERS-141): `2` added the dust log, Binance Pay and the delisted markets; `3`
 * keeps 12 months instead of 24; `4` estimates the history with its positions; `5` adds the Simple
 * Earn real-time rewards. A history started
 * under an older version gets its openings and its estimated history again (`rebase`), once.
 */
const HISTORY_VERSION = "5";
const PAGE = 500;
const PAY_PAGE = 100;
const REWARDS_PAGE = 100;
const TRADES_PAGE = 1000;
const DIVIDENDS_PAGE = 500;
/** A bound on every loop over pages: an exchange that keeps answering "more" stops here. */
const MAX_PAGES = 50;
const DAY_MS = 86_400_000;
/** A history started with 24 months (versions 1–2) starts 12 months later: its connection less 12. */
const SHORTENED_MS = (730 - HISTORY_DAYS) * DAY_MS;
const ONE_UNIT = "1";

function dailyRateOf(
  coin: string,
  currency: string,
  day: CivilDate,
  prices: Parameters<typeof dailyRate>[3],
  fx: FxLookup,
) {
  const rate = dailyRate(coin, currency, day, prices, fx);
  return rate ? { rate: decimal(rate.rate), source: rate.source } : null;
}

async function earnPages(read: (page: number) => Promise<unknown>, kind: "flexible" | "locked") {
  const pages: EarnPage[] = [];
  let seen = 0;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const one = earnPageOf(await read(page), kind);
    pages.push(one);
    seen += one.rows.length;
    if (one.rows.length < 100 || seen >= one.total) break;
  }
  return pages;
}

async function readBalances(api: BinanceApi): Promise<BalancesRead> {
  const account = await api.account();
  const funding = await api.fundingBalance();
  const earnFlexible = await earnPages((page) => api.earnFlexible(page), "flexible");
  const earnLocked = await earnPages((page) => api.earnLocked(page), "locked");
  return balancesOf({ account, funding, earnFlexible, earnLocked });
}

/** The daily closes the legs of `events` need, fetched once per market from their first day. */
async function dailyPricesFor(
  api: BinanceApi,
  events: readonly ProviderEvent[],
  currency: string,
  markets: ReadonlySet<string>,
  now: Date,
  /** Coins held, to be valued on `heldFrom` (the opening of the history). */
  held: readonly string[] = [],
  heldFrom: number | null = null,
) {
  const coins = new Set<string>();
  let first = now.getTime();
  if (heldFrom !== null) {
    for (const coin of held) if (coin !== currency && !isFiat(coin)) coins.add(coin);
    first = Math.min(first, heldFrom);
  }
  for (const event of events) {
    for (const leg of event.legs) {
      if (leg.nativeCurrency === currency || isFiat(leg.nativeCurrency)) continue;
      coins.add(leg.nativeCurrency);
      first = Math.min(first, event.occurredAt.getTime());
    }
  }
  const symbols = new Set([...coins].flatMap((coin) => candleSymbols(coin, currency, markets)));
  const closes = new Map<string, Map<CivilDate, bigint>>();
  const start = Math.floor(first / DAY_MS) * DAY_MS;
  for (const symbol of [...symbols].sort()) {
    const days = new Map<CivilDate, bigint>();
    for (let since = start, page = 0; since <= now.getTime() && page < 3; since += 1000 * DAY_MS, page += 1) {
      try {
        for (const [day, close] of closesOf(await api.dailyCandles(symbol, since))) days.set(day, close);
      } catch (error) {
        // A market that answers with nothing usable leaves its legs unpriced, never the pass failed.
        if (
          error instanceof SourceError &&
          (error.errorClass === "bad_response" || error.errorClass === "schema_mismatch")
        ) {
          break;
        }
        throw error;
      }
    }
    closes.set(symbol, days);
  }
  return { closes, markets };
}

export function binanceSource(
  apiOf: (credentials: Readonly<Record<string, string>>) => Promise<BinanceApi> = (credentials) =>
    binanceApi(BINANCE_PROVIDER, credentials),
): InvestmentSource {
  return {
    async verifyReadOnly(credentials) {
      const { check, ignored } = keyCheckOf(await (await apiOf(credentials)).apiRestrictions());
      // B1: a flag Ledgerly does not know, off, is accepted and logged — by name only.
      if (ignored.length > 0)
        console.warn("[investments] ccxt:binance flags off and unknown", ignored.join(","));
      return check;
    },

    async fetchHoldings(credentials, currency, now, fx?: FxLookup) {
      const api = await apiOf(credentials);
      const wallets = await api.walletBalance();
      const balances = await readBalances(api);
      const markets = new Set(await api.markets());
      const symbols = tickerSymbols(
        balances.quantities.map((one) => one.asset),
        currency,
        markets,
      );
      const quotes = symbols.length === 0 ? new Map() : quotesOf(await api.tickers(symbols));
      return holdingsOf({
        balances,
        wallets,
        quotes,
        currency,
        fx,
        observedAt: now,
        on: civilDateIn(now, "UTC"),
      });
    },

    async fetchFlows(credentials, now, options) {
      const currency = options?.currency ?? "EUR";
      const fx: FxLookup = options?.fx ?? (() => null);
      const cursor: FlowCursor = options?.cursor ?? {};
      const api = await apiOf(credentials);
      const parsedFrom = cursor.from ? new Date(cursor.from) : null;
      const valid = parsedFrom && !Number.isNaN(parsedFrom.getTime()) ? parsedFrom : null;
      const longer = valid !== null && (cursor.history === undefined || cursor.history === "2");
      const from =
        valid === null ? historyStart(now) : longer ? new Date(valid.getTime() + SHORTENED_MS) : valid;
      const fromMs = from.getTime();
      const nowMs = now.getTime();
      /** Where a stream starts again: 24 hours before it stopped (A7), never before the history. */
      const startOf = (key: string) => {
        const stopped = cursor[key] ? Date.parse(cursor[key]) : Number.NaN;
        return Number.isNaN(stopped) ? fromMs : Math.max(fromMs, Math.min(nowMs, stopped) - OVERLAP_MS);
      };
      const next: FlowCursor = { from: from.toISOString(), history: HISTORY_VERSION };
      const stopAt = (pendingFrom: number | null) =>
        new Date(pendingFrom === null ? nowMs : Math.max(fromMs, pendingFrom)).toISOString();
      const events: ProviderEvent[] = [];
      const assets = new Set((cursor.assets ?? "").split(",").filter((one) => /^[A-Z0-9]{1,20}$/.test(one)));
      const take = (rows: StreamRows) => {
        events.push(...rows.events);
        for (const asset of rows.assets) assets.add(asset);
        return rows.pendingFrom;
      };
      const earliest = (a: number | null, b: number | null) =>
        a === null ? b : b === null ? a : Math.min(a, b);

      // Crypto deposits and withdrawals: windows of 90 days (B7).
      for (const kind of ["deposit", "withdrawal"] as const) {
        const key = `${kind}s`;
        let pending: number | null = null;
        for (const window of windowsOf(startOf(key), nowMs, 90)) {
          const raw =
            kind === "deposit"
              ? await api.deposits(window.since, window.until)
              : await api.withdrawals(window.since, window.until);
          pending = earliest(pending, take(transferEventsOf(raw, kind, currency)));
        }
        next[key] = stopAt(pending);
      }

      // SEPA orders and card purchases (B2): slow calls, one range read by pages.
      for (const type of [0, 1] as const) {
        const key = `fiat_orders:${type}`;
        let pending: number | null = null;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const rows = fiatOrderEventsOf(await api.fiatOrders(type, startOf(key), nowMs, page), type, PAGE);
          pending = earliest(pending, take(rows));
          if (!rows.full) break;
        }
        next[key] = stopAt(pending);
      }
      {
        let pending: number | null = null;
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const rows = fiatPaymentEventsOf(
            await api.fiatPayments(startOf("fiat_payments"), nowMs, page),
            currency,
            PAGE,
          );
          pending = earliest(pending, take(rows));
          if (!rows.full) break;
        }
        next.fiat_payments = stopAt(pending);
      }

      // Convert: windows of 30 days (B2).
      for (const window of windowsOf(startOf("convert"), nowMs, 30)) {
        take(convertEventsOf(await api.convertFlow(window.since, window.until), currency));
      }
      next.convert = stopAt(null);

      // Rewards: windows of 180 days, at most 500 rows each — a full answer is read again below it.
      for (const window of windowsOf(startOf("dividends"), nowMs, 180)) {
        let until = window.until;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const rows = dividendEventsOf(await api.dividends(window.since, until), currency);
          take(rows);
          if (rows.count < DIVIDENDS_PAGE || rows.oldest === null || rows.oldest <= window.since) break;
          // The rows of the oldest millisecond may continue past the page: read it again (A7).
          until = rows.oldest < until ? rows.oldest : until - 1;
        }
      }
      next.dividends = stopAt(null);

      // Dust converted to BNB: windows of 90 days. It also names the coins sold out to the last
      // crumb, whose trades no other stream would find (PERS-141).
      for (const window of windowsOf(startOf("dust"), nowMs, 90)) {
        take(dustEventsOf(await api.dustLog(window.since, window.until), currency));
      }
      next.dust = stopAt(null);

      // Binance Pay: windows of 90 days, 18 months back at most, 100 orders an answer — a full one
      // is read again below its oldest order.
      const storedPay = cursor.pay_from ? Date.parse(cursor.pay_from) : Number.NaN;
      const payFrom = Number.isNaN(storedPay)
        ? Math.max(fromMs, nowMs - (PAY_HISTORY_DAYS - 1) * DAY_MS)
        : storedPay;
      next.pay_from = new Date(payFrom).toISOString();
      for (const window of windowsOf(Math.max(startOf("pay"), payFrom), nowMs, 90)) {
        let until = window.until;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const rows = payEventsOf(await api.payTransactions(window.since, until), currency);
          take(rows);
          if (rows.count < PAY_PAGE || rows.oldest === null || rows.oldest <= window.since) break;
          until = rows.oldest < until ? rows.oldest : until - 1;
        }
      }
      next.pay = stopAt(null);

      // Simple Earn real-time rewards: windows of 30 days, pages of 100 (PERS-141).
      for (const window of windowsOf(startOf("earn_rewards"), nowMs, 30)) {
        for (let page = 1; page <= MAX_PAGES; page += 1) {
          const rows = earnRewardEventsOf(await api.earnRewards(window.since, window.until, page), currency);
          take(rows);
          if (rows.count < REWARDS_PAGE) break;
        }
      }
      next.earn_rewards = stopAt(null);

      // Trades: every market of every coin seen anywhere (B3), by id from where each stopped (B7);
      // delisted markets too, since a coin sold out on one is still part of the history.
      const markets = new Set(await api.markets());
      const tradeMarkets = new Set(await api.tradeMarkets());
      const balances = await readBalances(api);
      for (const one of balances.quantities) assets.add(one.asset);
      for (const symbol of tradeSymbols(assets, currency, tradeMarkets)) {
        const key = `trades:${symbol}`;
        const stored = Number(cursor[key]);
        let fromId = Number.isSafeInteger(stored) && stored >= 0 ? stored : 0;
        let last: number | null = null;
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const rows = tradeEventsOf(await api.myTrades(symbol, fromId), currency);
          take(rows);
          if (rows.lastId !== null) last = last === null ? rows.lastId : Math.max(last, rows.lastId);
          if (rows.count < TRADES_PAGE || rows.lastId === null) break;
          fromId = rows.lastId + 1;
        }
        if (last !== null || cursor[key]) next[key] = String(last ?? fromId);
      }
      next.assets = [...assets].sort().join(",").slice(0, 4000);

      // Only the history the design keeps (D11): older trades of a market read by id are dropped.
      const kept = events.filter((event) => event.occurredAt.getTime() >= fromMs);
      const unique = [...new Map(kept.map((event) => [event.externalId, event])).values()];
      // The first pass starts the history: the coins held are valued on its first day (A6). So
      // does the first pass after the source learned to read more of it (PERS-141).
      const starting = !parsedFrom;
      const rebase = !starting && cursor.history !== HISTORY_VERSION;
      // Every coin held or moved: one sold out in the 24 months has an opening too (A6).
      const held = [
        ...new Set([
          ...balances.quantities.map((one) => one.asset),
          ...unique.flatMap((event) => event.legs.flatMap((leg) => (leg.asset ? [leg.asset.symbol] : []))),
        ]),
      ].sort();
      const prices = await dailyPricesFor(
        api,
        unique,
        currency,
        markets,
        now,
        held,
        starting || rebase ? fromMs : null,
      );
      const openingRates: Record<string, { rate: string; source: string }> = {};
      if (starting || rebase) {
        const day = civilDateIn(from, "UTC");
        for (const coin of held) {
          const rate =
            coin === currency
              ? { rate: ONE_UNIT, source: "par" }
              : dailyRateOf(coin, currency, day, prices, fx);
          if (rate) openingRates[coin] = rate;
        }
      }
      return {
        events: priceLegs(unique, currency, prices, fx),
        coverage: binanceCoverage(FLOW_STREAMS, from, now, { pay: new Date(payFrom) }),
        cursor: next,
        historyFrom: from,
        ...(starting || rebase ? { openingRates } : {}),
        ...(rebase ? { rebase: true } : {}),
      };
    },

    async fetchHistory() {
      // Binance has no daily history of the account's value: the module estimates it (PERS-100).
      return { points: [], coverage: [] };
    },

    async fetchDailyRates(credentials, coins, currency, from, now, fx) {
      const api = await apiOf(credentials);
      const markets = new Set(await api.markets());
      const wanted = [...new Set(coins)].filter((coin) => coin !== currency && !isFiat(coin)).sort();
      const prices = await dailyPricesFor(api, [], currency, markets, now, wanted, from.getTime());
      const rates: Record<string, Record<CivilDate, string>> = {};
      const last = civilDateIn(now, "UTC");
      for (const coin of wanted) {
        const days: Record<CivilDate, string> = {};
        for (let day = civilDateIn(from, "UTC"); day <= last; day = addDays(day, 1)) {
          const rate = dailyRateOf(coin, currency, day, prices, fx);
          if (rate) days[day] = rate.rate;
        }
        rates[coin] = days;
      }
      return rates;
    },
  };
}
