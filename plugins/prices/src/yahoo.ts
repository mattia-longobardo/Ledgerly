/**
 * Yahoo Finance's chart endpoint (`v8/finance/chart`): the only place that knows Yahoo's symbols
 * (rule M14). The core sends a ticker and the market's MIC; the suffix of the market is added here.
 *
 * The endpoint is no official API: Mattia accepted the licence risk on 22/11/2026, as for
 * financial-advisor-tools (docs/design/rewrite-plan/09-risks.md A8). Every answer is parsed before
 * it is believed, and the source's own words never leave this file.
 */
import { z } from "zod";

export const SOURCE_HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;
const BASE = `https://${SOURCE_HOSTS[1]}/v8/finance/chart/`;
/** Yahoo refuses a client with no browser name; a generic one, with nothing of the person. */
const USER_AGENT = "Mozilla/5.0 (compatible; Ledgerly)";
const TIMEOUT_MS = 15_000;

/** The suffix of each market Yahoo lists, by MIC (operating or segment). US markets have none. */
const SUFFIXES: Record<string, string> = {
  XMIL: ".MI",
  MTAA: ".MI",
  ETFP: ".MI",
  XMOT: ".MI",
  XETR: ".DE",
  XETA: ".DE",
  XFRA: ".F",
  XPAR: ".PA",
  XAMS: ".AS",
  XBRU: ".BR",
  XLIS: ".LS",
  XMAD: ".MC",
  XSWX: ".SW",
  XLON: ".L",
  XNYS: "",
  XNAS: "",
  ARCX: "",
  BATS: "",
};

/** Yahoo's symbol of a ticker on a market, or null for a market it does not list. */
export function yahooSymbol(ticker: string, mic: string): string | null {
  const suffix = SUFFIXES[mic];
  if (suffix === undefined) return null;
  // US class shares: "BRK.B" is "BRK-B" on Yahoo.
  const own = suffix === "" ? ticker.replace(/[./]/g, "-") : ticker;
  return `${own}${suffix}`.toUpperCase();
}

/** Quotes in a minor unit, converted to the major one: pence, cents, agorot. */
const MINOR_UNITS: Record<string, string> = { GBp: "GBP", GBX: "GBP", ZAc: "ZAR", ILA: "ILS" };

const chartSchema = z.object({
  chart: z.object({
    result: z
      .array(
        z.object({
          meta: z.object({
            currency: z.string().nullable(),
            gmtoffset: z.number(),
            currentTradingPeriod: z
              .object({ regular: z.object({ start: z.number(), end: z.number() }) })
              .optional(),
          }),
          timestamp: z.array(z.number()).optional(),
          indicators: z.object({ quote: z.array(z.object({ close: z.array(z.number().nullable()) })) }),
        }),
      )
      .nullable(),
    error: z.object({ code: z.string() }).nullable(),
  }),
});

export type Fetch = typeof globalThis.fetch;

/** Why a market has no bar: the codes of the contract's `errors`. */
export type BarsError = "unknown_symbol" | "no_data" | "rate_limited" | "provider_down";

export interface Bar {
  on: string;
  close: string;
  currency: string;
}

const civilDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);
const startOf = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

/** A price as a plain decimal of at most 8 places, from Yahoo's float; a minor unit is divided by 100. */
function decimal(value: number, minor: boolean): string {
  const fixed = (minor ? value / 100 : value).toFixed(8);
  return fixed.replace(/\.?0+$/, "");
}

/**
 * The daily closes of one symbol from `from` to `to`, both included, in the exchange's days. The
 * bar of a session still open is left out: it enters the next call, once final.
 */
export async function dailyCloses(
  symbol: string,
  range: { from: string; to: string },
  options: { fetchFn?: Fetch; now?: () => Date } = {},
): Promise<Bar[] | BarsError> {
  const doFetch = options.fetchFn ?? globalThis.fetch;
  // One day more on each side: the days are the exchange's, the bounds are UTC.
  const query = `?interval=1d&period1=${startOf(range.from) - 86_400}&period2=${startOf(range.to) + 2 * 86_400}`;
  let response: Response;
  try {
    response = await doFetch(`${BASE}${encodeURIComponent(symbol)}${query}`, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return "provider_down";
  }
  if (response.status === 429) return "rate_limited";
  if (response.status === 404) return "unknown_symbol";
  if (!response.ok) return "provider_down";
  const parsed = chartSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return "provider_down";
  const result = parsed.data.chart.result?.[0];
  if (!result) return parsed.data.chart.error ? "unknown_symbol" : "no_data";
  const { meta, timestamp = [] } = result;
  if (!meta.currency) return "no_data";
  const currency = MINOR_UNITS[meta.currency] ?? meta.currency;
  const minor = meta.currency in MINOR_UNITS;
  const closes = result.indicators.quote[0]?.close ?? [];
  const nowSeconds = (options.now ?? (() => new Date()))().getTime() / 1000;
  const regular = meta.currentTradingPeriod?.regular;
  // The session of the exchange's today, while it has not closed.
  const openDay = regular && nowSeconds < regular.end ? civilDay(regular.start + meta.gmtoffset) : null;
  const bars = new Map<string, Bar>();
  timestamp.forEach((seconds, index) => {
    const close = closes[index];
    const on = civilDay(seconds + meta.gmtoffset);
    if (close == null || close <= 0 || on === openDay || on < range.from || on > range.to) return;
    // The last bar of a day wins: Yahoo can repeat today's as the session's last minute.
    bars.set(on, { on, close: decimal(close, minor), currency });
  });
  return bars.size === 0 ? "no_data" : [...bars.values()];
}
