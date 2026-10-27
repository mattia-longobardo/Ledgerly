import { addDays, type CivilDate } from "../dates";

/**
 * Exchange rates (docs/design/investments.md §1.8). Market data, not a person's: one row per day
 * and currency for the whole instance, always against EUR. `ecb` is the European Central Bank's
 * reference rate, read through Frankfurter (api.frankfurter.dev): free, no key, every working day.
 */
export const FX_SOURCES = ["ecb"] as const;
export type FxSource = (typeof FX_SOURCES)[number];

/** The first ECB reference rate: there is nothing to fetch before it. */
export const ECB_FIRST_DAY: CivilDate = "1999-01-04";

/** The scale of `fx_rates.eur_per_unit` (`numeric(20,10)`). */
export const EUR_PER_UNIT_SCALE = 10;

export interface FxRate {
  on: CivilDate;
  currency: string;
  /** How many euro one unit of `currency` was worth on `on`, as `numeric(20,10)` text. */
  eurPerUnit: string;
}

export interface FxRange {
  from: CivilDate;
  to: CivilDate;
}

/**
 * The ECB publishes "1 EUR = `rate` units"; `fx_rates` stores the other way round, so that a value
 * in any currency becomes euro with one multiplication. `null` for a rate that cannot be one.
 */
export function eurPerUnitOf(rate: number): string | null {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const value = (1 / rate).toFixed(EUR_PER_UNIT_SCALE);
  return Number(value) > 0 ? value : null;
}

/**
 * What the daily job asks Frankfurter for, given what `fx_rates` already holds (§1.8):
 *
 *  - no balance anywhere: nothing, since there is nothing to convert; the run after the first
 *    balance does the backfill;
 *  - an empty table: everything from the instance's first balance to today — the one-off backfill;
 *  - a table that starts after the first balance: the days before it, so a past point has the rate
 *    of its own day too;
 *  - a table that ends before today: the days since, so a missed day fills itself in.
 *
 * Frankfurter answers a range with the last fixing on or before its first day, so a backfill that
 * starts on a Sunday still leaves a rate for that Sunday, and the first case does not come back.
 * Rows are immutable: a range that overlaps what is stored adds nothing.
 */
export function rangesToFetch(input: {
  firstBalanceOn: CivilDate | null;
  earliest: CivilDate | null;
  latest: CivilDate | null;
  today: CivilDate;
}): FxRange[] {
  if (input.firstBalanceOn === null) return [];
  // A balance dated in the future still needs no rate later than today's.
  const start = minDay(maxDay(input.firstBalanceOn, ECB_FIRST_DAY), input.today);
  if (input.earliest === null || input.latest === null) return [{ from: start, to: input.today }];
  const ranges: FxRange[] = [];
  if (input.earliest > start) ranges.push({ from: start, to: addDays(input.earliest, -1) });
  if (input.latest < input.today) ranges.push({ from: addDays(input.latest, 1), to: input.today });
  return ranges;
}

function maxDay(a: CivilDate, b: CivilDate): CivilDate {
  return a > b ? a : b;
}

function minDay(a: CivilDate, b: CivilDate): CivilDate {
  return a < b ? a : b;
}
