import type { TrekYearStats } from "@/lib/clients/trek";
import { getSetting, setSetting } from "./settings";

/**
 * Trek's own allowance/used/remaining, cached after each sync.
 *
 * Cached rather than fetched on render for one hard reason: `GET /stats/:year`
 * PERSISTS carry-over as a side effect upstream. Calling it from a page render
 * would poke Trek's database on every refresh. The sync calls it once,
 * deliberately, and the page reads what it left behind.
 *
 * The key is declared here rather than in `SETTING_KEYS` so this feature owns
 * its own storage and adds nothing to a shared module.
 */
const KEY_PREFIX = "trek_year_stats";

export interface CachedTrekStats {
  stats: TrekYearStats;
  fetchedAt: string;
}

function keyFor(year: number): string {
  return `${KEY_PREFIX}:${year}`;
}

export async function getCachedTrekStats(year: number): Promise<CachedTrekStats | null> {
  const raw = await getSetting<CachedTrekStats | null>(keyFor(year), null);
  if (raw === null || typeof raw !== "object") return null;
  // Defensive: the value is jsonb, so a shape change ships as data, not a
  // migration. A malformed cache reads as "no figures yet", never as a crash.
  return typeof raw.fetchedAt === "string" && typeof raw.stats === "object" && raw.stats !== null
    ? raw
    : null;
}

export async function setCachedTrekStats(
  year: number,
  stats: TrekYearStats,
  now = new Date(),
): Promise<void> {
  await setSetting(keyFor(year), { stats, fetchedAt: now.toISOString() } satisfies CachedTrekStats);
}
