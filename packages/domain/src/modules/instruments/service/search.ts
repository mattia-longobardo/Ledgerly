// The registry of instruments (rewrite plan R5d): the search «Record operation» starts from. What a
// source finds is kept, so the next search of the same instrument asks nobody.
import { asc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, type Tx } from "../../../platform/db/client";
import { isIsin, orderListings } from "../rules";
import { instrumentListings, instruments } from "../schema";
import { type FoundInstrument, lookupIsin, searchText, type SourceOptions, SourceError } from "./sources";

const MAX_HITS = 20;

export interface InstrumentHit {
  instrumentId: string;
  isin: string | null;
  name: string;
  class: FoundInstrument["class"];
  currency: string;
  listings: { listingId: string; mic: string; ticker: string | null; currency: string; priced: boolean }[];
}

export interface SearchDeps extends SourceOptions {
  /** The plugin that prices the markets, when the instance has one: a new market is read by it. */
  priceSourceId: string | null;
}

/** Stores what a source found, or brings an instrument up to date; answers its id. */
async function keep(found: FoundInstrument, priceSourceId: string | null, transaction: Tx): Promise<string> {
  const key = found.isin !== null ? eq(instruments.isin, found.isin) : eq(instruments.figi, found.figi ?? "");
  const values = {
    isin: found.isin,
    figi: found.figi,
    name: found.name,
    class: found.class,
    cfi: found.cfi,
    currency: found.currency,
    resolvedAt: new Date(),
  };
  const [existing] = await transaction.select({ id: instruments.id }).from(instruments).where(key);
  const id = existing
    ? (
        await transaction
          .update(instruments)
          .set({ ...values, updatedAt: new Date() })
          .where(key)
          .returning()
      )[0].id
    : (await transaction.insert(instruments).values(values).returning())[0].id;
  if (found.listings.length > 0) {
    await transaction
      .insert(instrumentListings)
      .values(found.listings.map((one) => ({ instrumentId: id, ...one, priceSource: priceSourceId })))
      // A market already known keeps its source and its last «no»: a search does not reset the job.
      .onConflictDoUpdate({
        target: [instrumentListings.instrumentId, instrumentListings.mic],
        set: { ticker: sql`excluded.ticker`, updatedAt: new Date() },
      });
  }
  return id;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

/** The instruments the registry holds for a text: by ISIN, or by a part of the name or the ticker. */
async function known(text: string): Promise<string[]> {
  const database = getDb();
  if (isIsin(text)) {
    return (
      await database.select({ id: instruments.id }).from(instruments).where(eq(instruments.isin, text))
    ).map((row) => row.id);
  }
  const rows = await database
    .selectDistinct({ id: instruments.id, name: instruments.name })
    .from(instruments)
    .leftJoin(instrumentListings, eq(instrumentListings.instrumentId, instruments.id))
    .where(
      or(
        ilike(instruments.name, `%${escapeLike(text)}%`),
        ilike(instrumentListings.ticker, escapeLike(text)),
      ),
    )
    .orderBy(asc(instruments.name))
    .limit(MAX_HITS);
  return rows.map((row) => row.id);
}

async function hits(ids: readonly string[]): Promise<InstrumentHit[]> {
  if (ids.length === 0) return [];
  const database = getDb();
  const [rows, markets] = await Promise.all([
    database
      .select()
      .from(instruments)
      .where(inArray(instruments.id, [...ids])),
    database
      .select()
      .from(instrumentListings)
      .where(inArray(instrumentListings.instrumentId, [...ids])),
  ]);
  return ids.flatMap((id) => {
    const row = rows.find((one) => one.id === id);
    if (!row) return [];
    const listings = orderListings(markets.filter((one) => one.instrumentId === id)).map((one) => ({
      listingId: one.id,
      mic: one.mic,
      ticker: one.ticker,
      currency: one.currency,
      priced: one.priceSource !== null,
    }));
    return [
      {
        instrumentId: id,
        isin: row.isin,
        name: row.name,
        class: row.class,
        currency: row.currency,
        listings,
      },
    ];
  });
}

/**
 * «Record operation»'s search: what the registry knows first; an ISIN it does not know, or a text,
 * is asked to OpenFIGI and FIRDS and kept. `complete` is false when a source did not answer: the
 * person still gets what is known.
 */
export async function searchInstruments(
  query: string,
  deps: SearchDeps,
): Promise<{ items: InstrumentHit[]; complete: boolean }> {
  const text = query.trim();
  const isin = text.toUpperCase();
  const local = await known(isIsin(isin) ? isin : text);
  if (isIsin(isin) && local.length > 0) return { items: await hits(local), complete: true };
  let found: FoundInstrument[];
  try {
    found = isIsin(isin)
      ? [await lookupIsin(isin, deps)].filter((one) => one !== null)
      : await searchText(text, deps);
  } catch (error) {
    if (!(error instanceof SourceError)) throw error;
    return { items: await hits(local), complete: false };
  }
  const kept = await getDb().transaction(async (transaction) => {
    const ids: string[] = [];
    for (const one of found.slice(0, MAX_HITS)) ids.push(await keep(one, deps.priceSourceId, transaction));
    return ids;
  });
  return { items: await hits([...new Set([...local, ...kept])].slice(0, MAX_HITS)), complete: true };
}

/** One instrument of the registry with its markets, or null: what a purchase names. */
export async function instrumentById(id: string): Promise<InstrumentHit | null> {
  return (await hits([id]))[0] ?? null;
}
