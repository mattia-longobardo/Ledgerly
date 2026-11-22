// The daily prices (rewrite plan R5d): the job's reading of the markets, and the reads of the closes
// for the module that values an asset.
import { and, asc, desc, eq, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { CivilDate } from "../../shared/dates";
import { getDb, type Tx } from "../../platform/db/client";
import type { PriceAnswer, PriceSource } from "./ports";
import { orderListings, pickDue, rangeToRead } from "./rules";
import { instrumentListings, instrumentPrices } from "./schema";

/** The markets of one call to the source: the plugin answers within the core's 60 seconds. */
const MARKETS_PER_CALL = 25;
/** A «no» that will not change at the next run: the market stops being read. */
const FINAL_REFUSALS = new Set(["unknown_symbol"]);

export interface PricedMarket {
  listingId: string;
  /** The first day an asset on this market needs a price for. */
  neededFrom: CivilDate;
}

export interface PricesRun {
  /** The markets whose closes changed, with the oldest day changed for each. */
  changed: Map<string, CivilDate>;
  read: number;
  /** Some market was left for another run: the cap, a refusal or a source down. */
  partial: boolean;
}

type Listing = typeof instrumentListings.$inferSelect;
interface Batch {
  from: CivilDate;
  to: CivilDate;
  markets: Listing[];
}

/** Keeps in `days` the earliest day of each key. */
function keepEarliest(days: Map<string, CivilDate>, key: string, day: CivilDate): void {
  const before = days.get(key);
  if (before === undefined || day < before) days.set(key, day);
}

/** The markets of the run within the cap, the oldest price first, grouped by the days they read. */
async function batchesOf(input: {
  source: PriceSource;
  markets: readonly PricedMarket[];
  today: CivilDate;
  cap: number;
}): Promise<{ batches: Batch[]; skipped: number }> {
  const ids = [...new Set(input.markets.map((one) => one.listingId))];
  const database = getDb();
  const [listings, lasts] = await Promise.all([
    database
      .select()
      .from(instrumentListings)
      .where(and(inArray(instrumentListings.id, ids), eq(instrumentListings.priceSource, input.source.id))),
    database
      .select({ listingId: instrumentPrices.listingId, lastOn: sql<CivilDate>`max(${instrumentPrices.on})` })
      .from(instrumentPrices)
      .where(and(inArray(instrumentPrices.listingId, ids), eq(instrumentPrices.source, input.source.id)))
      .groupBy(instrumentPrices.listingId),
  ]);
  const lastOf = new Map(lasts.map((row) => [row.listingId, row.lastOn]));
  const neededOf = new Map<string, CivilDate>();
  for (const one of input.markets) keepEarliest(neededOf, one.listingId, one.neededFrom);
  const due = pickDue(
    listings.map((one) => ({ ...one, lastOn: lastOf.get(one.id) ?? null })),
    input.cap,
  );
  // One call per range: the markets that read the same days travel together.
  const byRange = new Map<string, Batch>();
  for (const one of due) {
    const range = rangeToRead(one.lastOn, neededOf.get(one.id) ?? input.today, input.today);
    const key = `${range.from}..${range.to}`;
    const batch = byRange.get(key) ?? { ...range, markets: [] };
    batch.markets.push(one);
    byRange.set(key, batch);
  }
  const batches: Batch[] = [];
  for (const batch of byRange.values()) {
    for (let start = 0; start < batch.markets.length; start += MARKETS_PER_CALL) {
      batches.push({ ...batch, markets: batch.markets.slice(start, start + MARKETS_PER_CALL) });
    }
  }
  return { batches, skipped: listings.length - due.length };
}

/** Stores a source's closes: a new day is added, a corrected one updated. Answers the days changed. */
async function storeCloses(source: string, bars: PriceAnswer["bars"], transaction: Tx) {
  if (bars.length === 0) return [];
  return transaction
    .insert(instrumentPrices)
    .values(
      bars.map((bar) => ({
        listingId: bar.key,
        on: bar.on,
        close: bar.close,
        currency: bar.currency,
        source,
      })),
    )
    .onConflictDoUpdate({
      target: [instrumentPrices.listingId, instrumentPrices.on, instrumentPrices.source],
      set: { close: sql`excluded.close`, currency: sql`excluded.currency`, fetchedAt: new Date() },
      setWhere: sql`${instrumentPrices.close} is distinct from excluded.close`,
    })
    .returning({ listingId: instrumentPrices.listingId, day: instrumentPrices.on });
}

/** One answer of the source, in one transaction: its closes, and the reason of each market with none. */
async function storeAnswer(
  sourceId: string,
  batch: Batch,
  answer: PriceAnswer,
  run: PricesRun,
): Promise<void> {
  const asked = new Set(batch.markets.map((one) => one.id));
  const bars = answer.bars.filter((bar) => asked.has(bar.key) && bar.on >= batch.from && bar.on <= batch.to);
  await getDb().transaction(async (transaction) => {
    for (const row of await storeCloses(sourceId, bars, transaction))
      keepEarliest(run.changed, row.listingId, row.day);
    for (const refusal of answer.errors.filter((one) => asked.has(one.key))) {
      const final = FINAL_REFUSALS.has(refusal.code);
      run.partial ||= !final && refusal.code !== "no_data";
      await transaction
        .update(instrumentListings)
        .set({ unpricedReason: refusal.code, ...(final ? { priceSource: null } : {}), updatedAt: new Date() })
        .where(eq(instrumentListings.id, refusal.key));
    }
  });
}

/**
 * The daily job's work (rewrite plan R5d): the markets whose price is automatic, at most `cap` of
 * them, the oldest price first; each read again over its last days and stored. A market the source
 * does not know stops being read, with its reason.
 */
export async function refreshPrices(input: {
  source: PriceSource;
  markets: readonly PricedMarket[];
  today: CivilDate;
  cap: number;
}): Promise<PricesRun> {
  const run: PricesRun = { changed: new Map(), read: 0, partial: false };
  if (input.markets.length === 0) return run;
  const { batches, skipped } = await batchesOf(input);
  run.partial = skipped > 0;
  for (const batch of batches) {
    const answer = await input.source.closes({
      listings: batch.markets.map((one) => ({
        key: one.id,
        ticker: one.ticker ?? "",
        mic: one.mic,
        currency: one.currency,
      })),
      from: batch.from,
      to: batch.to,
    });
    await storeAnswer(input.source.id, batch, answer, run);
    run.read += batch.markets.length;
  }
  return run;
}

export interface Close {
  listingId: string;
  on: CivilDate;
  close: string;
  currency: string;
  source: string;
}

/** Every close of the markets up to `to`, oldest first: what the book of a portfolio values with. */
export async function closesUpTo(listingIds: readonly string[], to: CivilDate): Promise<Close[]> {
  if (listingIds.length === 0) return [];
  return getDb()
    .select()
    .from(instrumentPrices)
    .where(and(inArray(instrumentPrices.listingId, [...listingIds]), lte(instrumentPrices.on, to)))
    .orderBy(asc(instrumentPrices.on), desc(instrumentPrices.fetchedAt));
}

/** The last close of each market on or before `day`, for the «to update» state of an asset. */
export async function lastCloses(listingIds: readonly string[], day: CivilDate): Promise<Map<string, Close>> {
  if (listingIds.length === 0) return new Map();
  const rows = await getDb()
    .selectDistinctOn([instrumentPrices.listingId])
    .from(instrumentPrices)
    .where(and(inArray(instrumentPrices.listingId, [...listingIds]), lte(instrumentPrices.on, day)))
    .orderBy(instrumentPrices.listingId, desc(instrumentPrices.on), desc(instrumentPrices.fetchedAt));
  return new Map(rows.map((row) => [row.listingId, row]));
}

/** The markets of an instrument that a source prices, for the fallback to Xetra (S3). */
export async function pricedListings(instrumentId: string): Promise<{ listingId: string; mic: string }[]> {
  const rows = await getDb()
    .select({ listingId: instrumentListings.id, mic: instrumentListings.mic })
    .from(instrumentListings)
    .where(and(eq(instrumentListings.instrumentId, instrumentId), isNotNull(instrumentListings.priceSource)));
  return orderListings(rows);
}
