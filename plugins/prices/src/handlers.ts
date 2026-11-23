/**
 * `POST /prices` of contract v1 (rewrite plan R5d): the daily closes of the markets the core asks
 * for. One source call per market, one after the other; nothing is kept between two calls.
 */
import { pricesRequestSchema, type PricesResponse } from "@ledgerly/plugin-contract";
import { PluginFailure } from "./failure";
import { dailyCloses, type Fetch, yahooSymbol } from "./yahoo";

/** The time one call may spend: the core waits 60 seconds. What does not fit is `rate_limited`. */
const BUDGET_MS = 40_000;

export interface Deps {
  fetchFn?: Fetch;
  now?: () => Date;
  /** The clock of the budget; the tests move it. */
  elapsed?: () => number;
}

export async function prices(body: unknown, deps: Deps = {}): Promise<PricesResponse> {
  const parsed = pricesRequestSchema.safeParse(body);
  if (!parsed.success || parsed.data.from > parsed.data.to) throw new PluginFailure("invalid_request");
  const { listings, from, to } = parsed.data;
  const started = Date.now();
  const elapsed = deps.elapsed ?? (() => Date.now() - started);
  const answer: PricesResponse = { bars: [], errors: [] };
  // After a refusal of the source, the rest waits for the next run: asking again only prolongs it.
  let stopped = false;
  for (const listing of listings) {
    const symbol = yahooSymbol(listing.ticker, listing.mic);
    if (symbol === null) {
      answer.errors.push({ key: listing.key, code: "unknown_symbol" });
      continue;
    }
    if (stopped || elapsed() > BUDGET_MS) {
      answer.errors.push({ key: listing.key, code: "rate_limited" });
      continue;
    }
    const bars = await dailyCloses(symbol, { from, to }, deps);
    if (typeof bars === "string") {
      stopped = bars === "rate_limited";
      answer.errors.push({ key: listing.key, code: bars });
    } else {
      answer.bars.push(...bars.map((bar) => ({ key: listing.key, ...bar })));
    }
  }
  return answer;
}
