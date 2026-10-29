/**
 * `fx-rates-refresh` (docs/design/investments.md §1.8): the ECB reference rates of every currency,
 * once a day, into `fx_rates`. The first run is the backfill: it fetches the whole series from the
 * instance's oldest balance, so a past point is converted at the rate of its own day. Each run
 * after that fetches only the days the table does not hold yet (`rangesToFetch`).
 *
 * The ECB publishes around 16:00 CET and the daily tier runs at noon, so a day's rate arrives the
 * day after. A failed fetch writes nothing and the next day asks for the same days again.
 */
import "server-only";
import { firstBalanceDay } from "@/modules/accounts/queries";
import { forEachUser } from "@/modules/users/jobs";
import { type CivilDate, today } from "@/platform/dates";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { rangesToFetch } from "./rules";
import { saveRates, storedRange } from "./service";
import { fetchEcbRates, type FxFetchOptions } from "./sources";

/** The oldest balance day of the whole instance: the earliest of every user's own. */
async function instanceFirstBalanceDay(): Promise<CivilDate | null> {
  let first: CivilDate | null = null;
  await forEachUser("fx-rates-refresh", async (_person, ctx) => {
    const mine = await firstBalanceDay(ctx);
    if (mine !== null && (first === null || mine < first)) first = mine;
  });
  return first;
}

export async function refreshFxRates(
  options: FxFetchOptions = {},
  now: Date = new Date(),
): Promise<JobDetail> {
  const stored = await storedRange();
  const ranges = rangesToFetch({
    firstBalanceOn: await instanceFirstBalanceDay(),
    earliest: stored.earliest,
    latest: stored.latest,
    today: today("UTC", now),
  });
  let fetched = 0;
  let inserted = 0;
  for (const range of ranges) {
    const rates = await fetchEcbRates(range, options);
    fetched += rates.length;
    inserted += await saveRates(rates, now);
  }
  const after = await storedRange();
  return { ranges: ranges.length, fetched, inserted, earliest: after.earliest, latest: after.latest };
}

export function createFxRatesRefreshJob(options: FxFetchOptions = {}): JobDefinition {
  return { name: "fx-rates-refresh", tier: "daily", run: () => refreshFxRates(options) };
}

export const fxRatesRefreshJob = createFxRatesRefreshJob();
