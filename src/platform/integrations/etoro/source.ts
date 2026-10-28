/**
 * eToro as an {@link InvestmentSource} (docs/design/investments.md §3.3): the client's calls in
 * the order a pass makes them, mapped by `mapping.ts`. No database, no state between calls.
 */
import { civilDateIn } from "@/platform/dates";
import { type InvestmentSource, SourceError } from "../investments/source";
import { EtoroClient, type EtoroClientOptions } from "./client";
import {
  cashEventsOf,
  FLOWS_FROM,
  flowsCoverage,
  historyFrom,
  historyOf,
  holdingsOf,
  keyCheckOf,
  portfolioInstrumentIds,
  productOf,
  tradeEventsOf,
} from "./mapping";

/**
 * The names of the instruments, best effort: the metadata endpoint was not part of the spike, so
 * a changed shape costs the names (the asset is then named by its id and the reading is partial),
 * never the reading or the history. A refused key or a rate limit still stops the pass.
 */
async function instrumentsOf(client: EtoroClient, ids: readonly number[]) {
  if (ids.length === 0) return [];
  try {
    return await client.instruments(ids);
  } catch (error) {
    if (
      error instanceof SourceError &&
      (error.errorClass === "schema_mismatch" ||
        error.errorClass === "bad_response" ||
        error.errorClass === "unavailable")
    ) {
      return [];
    }
    throw error;
  }
}

function clientOf(credentials: Readonly<Record<string, string>>, options: EtoroClientOptions): EtoroClient {
  const apiKey = credentials.api_key;
  const userKey = credentials.user_key;
  if (!apiKey || !userKey) throw new SourceError("etoro", "auth");
  return new EtoroClient({ apiKey, userKey }, options);
}

export function etoroSource(options: EtoroClientOptions = {}): InvestmentSource {
  return {
    async verifyReadOnly(credentials) {
      return keyCheckOf(await clientOf(credentials, options).me());
    },

    async fetchHoldings(credentials, currency, now) {
      const client = clientOf(credentials, options);
      const balances = await client.balances(currency);
      const portfolio = await client.portfolio();
      const ids = portfolioInstrumentIds(portfolio);
      const instruments = await instrumentsOf(client, ids);
      return holdingsOf({ balances, portfolio, instruments, currency, observedAt: now });
    },

    async fetchFlows(credentials, now) {
      const client = clientOf(credentials, options);
      const trades = await client.trades(FLOWS_FROM);
      const instruments = new Map(
        (
          await instrumentsOf(
            client,
            trades.map((trade) => trade.instrumentId),
          )
        ).map((one) => [one.instrumentID, one]),
      );
      // eToro Money's account id, from `/balances` (E6): never kept as a key, only used for the path.
      const balances = await client.balances("USD");
      const cash = balances.balances.find((one) => productOf(one.accountType).product === "cash");
      const transactions = cash ? await client.cashTransactions(cash.accountId) : [];
      return {
        events: [...tradeEventsOf(trades, instruments), ...cashEventsOf(transactions)],
        coverage: flowsCoverage(transactions, cash !== undefined, now),
      };
    },

    async fetchHistory(credentials, currency, now) {
      const todayOn = civilDateIn(now, "UTC");
      const from = historyFrom(todayOn);
      const history = await clientOf(credentials, options).history(currency, from);
      return historyOf(history, currency, from, todayOn);
    },
  };
}
