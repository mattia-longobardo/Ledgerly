/**
 * The calls Ledgerly makes to an exchange through ccxt (docs/design/investments.md §3.2): read
 * only, one instance per pass, never cached. The answers stay raw (`unknown`): `binance.ts`
 * validates and maps them, so the mapping is tested on the spike's fixtures and the pass on a
 * fake exchange, without the network.
 *
 * SEC-03: the options are built here, field by field — the key, the secret, rate limit, timeout,
 * no verbose — and nothing else: never `urls`, `hostname`, a proxy, nor a spread of what the
 * person typed. The exchange class comes from the catalog's `ccxtId`, never from the input.
 */
import { SourceError, type SourceErrorClass } from "../investments/source";

/** The raw answers a Binance source needs, one method per endpoint (§3.2, D18). */
export interface BinanceApi {
  /** `GET /sapi/v1/account/apiRestrictions`: the key's permissions (B1). */
  apiRestrictions(): Promise<unknown>;
  /** `GET /api/v3/account` without zero balances: the spot wallet and the `uid` (B7). */
  account(): Promise<unknown>;
  /** `GET /sapi/v1/asset/wallet/balance`: every wallet's value in BTC, the reading's scope (B4). */
  walletBalance(): Promise<unknown>;
  /** The funding wallet, as ccxt's `fetchBalance({ type: "funding" }).info`. */
  fundingBalance(): Promise<unknown>;
  /** Simple Earn, a page of 100 (B4). */
  earnFlexible(page: number): Promise<unknown>;
  earnLocked(page: number): Promise<unknown>;
  /** The active spot markets, as ccxt symbols (`BTC/EUR`). */
  markets(): Promise<readonly string[]>;
  /** Every spot market, delisted ones too: their trades stay readable (`MKR/USDT`, PERS-141). */
  tradeMarkets(): Promise<readonly string[]>;
  tickers(symbols: readonly string[]): Promise<unknown>;
  /** Daily candles from `since`, oldest first, at most 1000. */
  dailyCandles(symbol: string, since: number): Promise<unknown>;
  /** Crypto deposits and withdrawals of a window of at most 90 days (B7). */
  deposits(since: number, until: number): Promise<unknown>;
  withdrawals(since: number, until: number): Promise<unknown>;
  /** SEPA deposits (0) and withdrawals (1), a page of 500 (B2). */
  fiatOrders(type: 0 | 1, since: number, until: number, page: number): Promise<unknown>;
  /** Card purchases, a page of 500 (B2). */
  fiatPayments(since: number, until: number, page: number): Promise<unknown>;
  /** Convert, a window of at most 30 days (B2). */
  convertFlow(since: number, until: number): Promise<unknown>;
  /** Rewards, staking, airdrops: a window of at most 180 days, at most 500 rows (B2). */
  dividends(since: number, until: number): Promise<unknown>;
  /** Small balances converted to BNB (`GET /sapi/v1/asset/dribblet`): a window of at most 90 days. */
  dustLog(since: number, until: number): Promise<unknown>;
  /** Binance Pay orders (`GET /sapi/v1/pay/transactions`): 90 days at most, 18 months back, 100 rows. */
  payTransactions(since: number, until: number): Promise<unknown>;
  /** The trades of a market from `fromId` on, oldest first, at most 1000 (B7). */
  myTrades(symbol: string, fromId: number): Promise<unknown>;
}

/** Fiat calls answer in about 30 s (B2): the timeout leaves them room. */
export const CCXT_TIMEOUT_MS = 35_000;

/**
 * The constructor options of an exchange, built from the two credentials and nothing else
 * (SEC-03). Exported for the test that proves an extra field never reaches ccxt.
 */
export function exchangeOptions(credentials: Readonly<Record<string, string>>) {
  const apiKey = credentials.api_key;
  const secret = credentials.secret;
  if (!apiKey || !secret) throw new SourceError("ccxt", "auth");
  return {
    apiKey,
    secret,
    enableRateLimit: true,
    timeout: CCXT_TIMEOUT_MS,
    verbose: false,
    // Spot markets only, and no private currency list: fewer calls, nothing the pass does not read.
    options: { defaultType: "spot" as const, fetchMarkets: { types: ["spot"] }, fetchCurrencies: false },
  };
}

type CcxtModule = typeof import("ccxt");

/** ccxt is ~70 MB: required at run time (`serverExternalPackages`), only by a pass that needs it. */
async function loadCcxt(): Promise<CcxtModule> {
  return import("ccxt");
}

/**
 * A ccxt failure as one of the allowed classes (§5.1, SEC-04): the class only — ccxt's message
 * carries the URL, the signed query and the exchange's body, so it is never read, kept or printed.
 */
export function ccxtErrorOf(ccxt: CcxtModule, provider: string, error: unknown): SourceError {
  if (error instanceof SourceError) return error;
  const is = (type: unknown) => typeof type === "function" && error instanceof (type as typeof Error);
  let errorClass: SourceErrorClass = "bad_response";
  if (is(ccxt.PermissionDenied)) errorClass = "permission";
  else if (is(ccxt.AuthenticationError)) errorClass = "auth";
  else if (is(ccxt.RateLimitExceeded) || is(ccxt.DDoSProtection)) errorClass = "rate_limited";
  else if (is(ccxt.RequestTimeout)) errorClass = "timeout";
  else if (is(ccxt.ExchangeNotAvailable) || is(ccxt.OnMaintenance)) errorClass = "unavailable";
  else if (is(ccxt.BadResponse) || is(ccxt.NullResponse)) errorClass = "bad_response";
  else if (is(ccxt.NetworkError)) errorClass = "network";
  return new SourceError(provider, errorClass);
}

/** The Binance calls on a fresh ccxt instance; every failure leaves as a {@link SourceError}. */
export async function binanceApi(
  provider: string,
  credentials: Readonly<Record<string, string>>,
): Promise<BinanceApi> {
  const ccxt = await loadCcxt();
  const exchange = new ccxt.binance(exchangeOptions(credentials));
  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw ccxtErrorOf(ccxt, provider, error);
    }
  };
  let spot: { symbol: string; active: boolean }[] | null = null;
  const spotMarkets = async () => {
    if (spot === null) {
      const loaded = await exchange.loadMarkets();
      spot = Object.values(loaded)
        .filter((market) => market !== undefined && market.spot)
        .map((market) => ({ symbol: market!.symbol, active: market!.active !== false }));
    }
    return spot;
  };
  return {
    apiRestrictions: () => call(() => exchange.sapiGetAccountApiRestrictions()),
    account: () => call(() => exchange.privateGetAccount({ omitZeroBalances: "true" })),
    walletBalance: () => call(() => exchange.sapiGetAssetWalletBalance()),
    fundingBalance: () => call(async () => (await exchange.fetchBalance({ type: "funding" })).info),
    earnFlexible: (page) =>
      call(() => exchange.sapiGetSimpleEarnFlexiblePosition({ current: page, size: 100 })),
    earnLocked: (page) => call(() => exchange.sapiGetSimpleEarnLockedPosition({ current: page, size: 100 })),
    markets: () =>
      call(async () =>
        (await spotMarkets()).filter((market) => market.active).map((market) => market.symbol),
      ),
    tradeMarkets: () => call(async () => (await spotMarkets()).map((market) => market.symbol)),
    tickers: (symbols) => call(() => exchange.fetchTickers([...symbols])),
    dailyCandles: (symbol, since) => call(() => exchange.fetchOHLCV(symbol, "1d", since, 1000)),
    deposits: (since, until) =>
      call(() => exchange.fetchDeposits(undefined, since, 1000, { endTime: until })),
    withdrawals: (since, until) =>
      call(() => exchange.fetchWithdrawals(undefined, since, 1000, { endTime: until })),
    fiatOrders: (type, since, until, page) =>
      call(() =>
        exchange.sapiGetFiatOrders({
          transactionType: type,
          beginTime: since,
          endTime: until,
          page,
          rows: 500,
        }),
      ),
    fiatPayments: (since, until, page) =>
      call(() =>
        exchange.sapiGetFiatPayments({
          transactionType: 0,
          beginTime: since,
          endTime: until,
          page,
          rows: 500,
        }),
      ),
    convertFlow: (since, until) =>
      call(() => exchange.sapiGetConvertTradeFlow({ startTime: since, endTime: until, limit: 1000 })),
    dividends: (since, until) =>
      call(() => exchange.sapiGetAssetAssetDividend({ startTime: since, endTime: until, limit: 500 })),
    dustLog: (since, until) =>
      call(() => exchange.sapiGetAssetDribblet({ startTime: since, endTime: until })),
    payTransactions: (since, until) =>
      call(() => exchange.sapiGetPayTransactions({ startTime: since, endTime: until, limit: 100 })),
    myTrades: (symbol, fromId) => call(() => exchange.fetchMyTrades(symbol, undefined, 1000, { fromId })),
  };
}
