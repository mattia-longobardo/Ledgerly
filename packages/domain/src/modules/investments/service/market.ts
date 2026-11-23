// The daily closes of the registry in a manual portfolio (rewrite plan R5d): an asset whose price is
// automatic is valued at the close of the market of the order, or of Xetra when that market has no
// source (decision S3). A close is a valuation of its day; one typed by hand the same day wins.
import { type MarketKey, marketPrices } from "../ports";
import { parseDecimal } from "../../../shared/money";
import { PRICE_SCALE, type EventLike } from "../rules";
import type { InvestmentAsset, InvestmentHolding } from "./types";

/** The farthest day a close is read up to: every close the registry has. */
const LAST_DAY = "9999-12-31";

/** The markets an asset may be priced on, the order's first: none for a price by hand. */
function marketsOf(asset: Pick<InvestmentAsset, "instrumentId" | "mic" | "priceSource">): MarketKey[] {
  if (asset.priceSource !== "market" || asset.instrumentId === null) return [];
  const fallback = marketPrices().fallbackMic;
  const own = asset.mic === null ? [] : [{ instrumentId: asset.instrumentId, mic: asset.mic }];
  return asset.mic === fallback ? own : [...own, { instrumentId: asset.instrumentId, mic: fallback }];
}

/** The listing each asset is priced on: the first of its markets that a source prices. */
export async function pricedListingOf(
  assets: readonly Pick<InvestmentAsset, "id" | "instrumentId" | "mic" | "priceSource">[],
): Promise<Map<string, string>> {
  const prices = marketPrices();
  const listings = await prices.listingsOf(assets.flatMap(marketsOf));
  const byAsset = new Map<string, string>();
  for (const asset of assets) {
    const priced = marketsOf(asset)
      .map((market) => listings.get(prices.marketKey(market)))
      .find((listing) => listing?.priceSource !== null && listing !== undefined);
    if (priced) byAsset.set(asset.id, priced.listingId);
  }
  return byAsset;
}

/** After every event of its day: a close is the day's last price (the instant only orders the day). */
const AFTER_THE_DAY = new Date("9999-12-31T23:59:59.999Z");

/** The holding and day of each valuation typed by hand: there, the close gives way. */
function typedValuations(events: readonly EventLike[]): Set<string> {
  return new Set(
    events.flatMap((event) =>
      event.origin === "manual"
        ? event.operations
            .filter((operation) => operation.kind === "valuation")
            .map((operation) => `${operation.holdingId}:${event.on}`)
        : [],
    ),
  );
}

/**
 * The closes of the automatic assets of a portfolio as valuations, from the day each holding opened.
 * A close is the last price of its day, after a purchase or a sale of that day; a valuation typed by
 * hand the same day wins, and its close is left out.
 */
export async function marketEvents(
  holdings: readonly (InvestmentHolding & { asset: InvestmentAsset })[],
  bookEvents: readonly EventLike[],
): Promise<EventLike[]> {
  const typed = typedValuations(bookEvents);
  const listingOf = await pricedListingOf(holdings.map((holding) => holding.asset));
  const closes = await marketPrices().closesUpTo([...new Set(listingOf.values())], LAST_DAY);
  const events: EventLike[] = [];
  for (const holding of holdings) {
    const listingId = listingOf.get(holding.asset.id);
    if (holding.origin !== "manual" || listingId === undefined) continue;
    for (const close of closes) {
      if (close.listingId !== listingId || close.on < holding.openedOn) continue;
      if (typed.has(`${holding.id}:${close.on}`)) continue;
      events.push({
        id: `close:${holding.id}:${close.on}`,
        on: close.on,
        occurredAt: AFTER_THE_DAY,
        seq: 0n,
        origin: "provider",
        transferGroupId: null,
        operations: [
          {
            leg: "main",
            holdingId: holding.id,
            kind: "valuation",
            quantity: null,
            unitPrice: parseDecimal(close.close, PRICE_SCALE),
            priceCurrency: close.currency,
            amountCents: 0n,
            fxRate: null,
            validUntil: null,
          },
        ],
      });
    }
  }
  return events;
}
