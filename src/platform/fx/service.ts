import "server-only";
import { and, asc, eq, gte, max, min } from "drizzle-orm";
import type { CivilDate } from "../dates";
import { getDb } from "../db/client";
import type { FxRate } from "./rules";
import { fxRates } from "./schema";

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

/** Every stored rate of one currency from `from` on, oldest first: what the tests compare. */
export async function listRates(currency: string, from: CivilDate = "1999-01-01"): Promise<FxRate[]> {
  return getDb()
    .select({ on: fxRates.on, currency: fxRates.currency, eurPerUnit: fxRates.eurPerUnit })
    .from(fxRates)
    .where(and(eq(fxRates.currency, currency), gte(fxRates.on, from)))
    .orderBy(asc(fxRates.on));
}
