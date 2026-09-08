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
 *
 * ⚠ SCOPED BY USER. `app_settings` carries no RLS and no `user_id`, so a key
 * of `trek_year_stats:<year>` alone would be one global row that every
 * workspace reads as its own — one person's allowance, used and remaining
 * days shown to the next. The owner's id is part of the key instead, and
 * nothing reads the old unscoped key: a stale global row is simply invisible
 * and is replaced by the first per-user sync.
 */
const KEY_PREFIX = "trek_year_stats";

export interface CachedTrekStats {
  stats: TrekYearStats;
  fetchedAt: string;
}

function keyFor(userId: string, year: number): string {
  return `${KEY_PREFIX}:${userId}:${year}`;
}

export async function getCachedTrekStats(
  userId: string,
  year: number,
): Promise<CachedTrekStats | null> {
  const raw = await getSetting<CachedTrekStats | null>(keyFor(userId, year), null);
  if (raw === null || typeof raw !== "object") return null;
  // Defensive: the value is jsonb, so a shape change ships as data, not a
  // migration. A malformed cache reads as "no figures yet", never as a crash.
  return typeof raw.fetchedAt === "string" && typeof raw.stats === "object" && raw.stats !== null
    ? raw
    : null;
}

export async function setCachedTrekStats(
  userId: string,
  year: number,
  stats: TrekYearStats,
  now = new Date(),
): Promise<void> {
  await setSetting(
    keyFor(userId, year),
    { stats, fetchedAt: now.toISOString() } satisfies CachedTrekStats,
  );
}
