import { and, asc, desc, eq, gte, inArray, lt, lte, max, min } from "drizzle-orm";
import type { CivilDate } from "../../shared/dates";
import { getDb } from "../db/client";
import { type FxRate, NO_RATES, type RateTable, rangesToFetch, rateTable } from "./rules";
import { fxRates } from "./schema";
import { type FxFetchOptions, fetchEcbRates } from "./sources";

/** Postgres takes at most 65,535 parameters a statement; five columns a row stays well below. */
const BATCH = 2_000;

/** The first and the last day `fx_rates` holds a rate for; both `null` while it is empty. */
export async function storedRange(): Promise<{ earliest: CivilDate | null; latest: CivilDate | null }> {
  const [row] = await getDb()
    .select({ earliest: min(fxRates.on), latest: max(fxRates.on) })
    .from(fxRates);
  return { earliest: row?.earliest ?? null, latest: row?.latest ?? null };
}

/**
 * Stores the rates a fetch brought back, in one transaction, and never overwrites one already
 * there (§1.8: immutable rows). Returns how many were new. The fetch happens before, outside.
 */
export async function saveRates(rates: readonly FxRate[], fetchedAt: Date = new Date()): Promise<number> {
  if (rates.length === 0) return 0;
  return getDb().transaction(async (tx) => {
    let inserted = 0;
    for (let i = 0; i < rates.length; i += BATCH) {
      const rows = await tx
        .insert(fxRates)
        .values(rates.slice(i, i + BATCH).map((rate) => ({ ...rate, source: "ecb" as const, fetchedAt })))
        .onConflictDoNothing()
        .returning({ on: fxRates.on });
      inserted += rows.length;
    }
    return inserted;
  });
}

/**
 * The one way rates enter `fx_rates` (audit PLT-2, INV-10): fetches from the ECB the days of
 * `from`..`to` the table lacks (`rangesToFetch`) and stores them. `from` is `null` when there is
 * nothing to convert. With `forward: false` only the days before the first stored one are fetched:
 * a sync needs the rates of its past events, and the daily job brings the newest days.
 */
export async function ensureRange(
  from: CivilDate | null,
  to: CivilDate,
  options: FxFetchOptions & { forward?: boolean } = {},
  now: Date = new Date(),
): Promise<{ ranges: number; fetched: number; inserted: number }> {
  const stored = await storedRange();
  const ranges = rangesToFetch({ firstBalanceOn: from, ...stored, today: to }).filter(
    (range) => options.forward !== false || stored.earliest === null || range.to < stored.earliest,
  );
  let fetched = 0;
  let inserted = 0;
  for (const range of ranges) {
    const rates = await fetchEcbRates(range, options);
    fetched += rates.length;
    inserted += await saveRates(rates, now);
  }
  return { ranges: ranges.length, fetched, inserted };
}

/** Every stored rate of one currency from `from` on, oldest first: what the tests compare. */
export async function listRates(currency: string, from: CivilDate = "1999-01-01"): Promise<FxRate[]> {
  return getDb()
    .select({ on: fxRates.on, currency: fxRates.currency, eurPerUnit: fxRates.eurPerUnit })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), gte(fxRates.on, from)))
    .orderBy(asc(fxRates.on));
}

/**
 * The rates a reader needs to convert values dated between `from` and `to` (§1.8): every stored
 * rate of `currencies` in that window, plus the last one before `from`, so the first days of the
 * window (a weekend, a holiday) still have the fixing before them. EUR needs no row and is skipped;
 * with nothing left to convert there is no query at all, which is the all-EUR case.
 */
export async function ratesOn(
  currencies: Iterable<string>,
  from: CivilDate,
  to: CivilDate,
): Promise<RateTable> {
  const wanted = [...new Set(currencies)].filter((currency) => currency !== "EUR").sort();
  if (wanted.length === 0) return NO_RATES;
  const columns = { on: fxRates.on, currency: fxRates.currency, eurPerUnit: fxRates.eurPerUnit };
  const [before, inside] = await Promise.all([
    getDb()
      .selectDistinctOn([fxRates.currency], columns)
      .from(fxRates)
      .where(and(inArray(fxRates.currency, wanted), lt(fxRates.on, from)))
      .orderBy(asc(fxRates.currency), desc(fxRates.on)),
    getDb()
      .select(columns)
      .from(fxRates)
      .where(and(inArray(fxRates.currency, wanted), gte(fxRates.on, from), lte(fxRates.on, to)))
      .orderBy(asc(fxRates.currency), asc(fxRates.on)),
  ]);
  return rateTable([...before, ...inside]);
}
