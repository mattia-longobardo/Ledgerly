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

/**
 * The currencies the ECB publishes a reference rate for today, against EUR (Frankfurter
 * `/currencies`, 28/10/2026). BGN left the list when Bulgaria adopted the euro (01/01/2026): its old
 * rates stay in `fx_rates`, but a display currency has to have a rate for today.
 */
export const ECB_CURRENCIES = [
  "AUD",
  "BRL",
  "CAD",
  "CHF",
  "CNY",
  "CZK",
  "DKK",
  "GBP",
  "HKD",
  "HUF",
  "IDR",
  "ILS",
  "INR",
  "ISK",
  "JPY",
  "KRW",
  "MXN",
  "MYR",
  "NOK",
  "NZD",
  "PHP",
  "PLN",
  "RON",
  "SEK",
  "SGD",
  "THB",
  "TRY",
  "USD",
  "ZAR",
] as const;

/** What the totals can be shown in (§1.8, D1): EUR or a currency the ECB publishes. */
export const DISPLAY_CURRENCIES = ["EUR", ...ECB_CURRENCIES] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];
export const DEFAULT_DISPLAY_CURRENCY: DisplayCurrency = "EUR";

export function isDisplayCurrency(value: string): value is DisplayCurrency {
  return (DISPLAY_CURRENCIES as readonly string[]).includes(value);
}

const SCALE = 10n ** BigInt(EUR_PER_UNIT_SCALE);

/** One stored rate as integer units of 10⁻¹⁰ EUR, so a conversion never meets a float. */
export interface ScaledRate {
  on: CivilDate;
  eurPerUnit: bigint;
}

/**
 * The rates a reader loaded (`ratesOn`), per currency, oldest first. EUR has no entry: it is 1.
 * A table with no entry for a currency means "no rate known", never parity.
 */
export type RateTable = ReadonlyMap<string, readonly ScaledRate[]>;

export const NO_RATES: RateTable = new Map();

/** `numeric(20,10)` text ("1.1953429439") as integer units of 10⁻¹⁰. */
export function scaledOf(eurPerUnit: string): bigint {
  const [whole, fraction = ""] = eurPerUnit.split(".");
  return (
    BigInt(whole) * SCALE + BigInt(fraction.padEnd(EUR_PER_UNIT_SCALE, "0").slice(0, EUR_PER_UNIT_SCALE))
  );
}

/** Builds a `RateTable` from stored rows in any order. */
export function rateTable(rows: readonly FxRate[]): RateTable {
  const table = new Map<string, ScaledRate[]>();
  for (const row of rows) {
    const list = table.get(row.currency) ?? [];
    list.push({ on: row.on, eurPerUnit: scaledOf(row.eurPerUnit) });
    table.set(row.currency, list);
  }
  for (const list of table.values()) list.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  return table;
}

/**
 * What one unit of `currency` was worth in EUR on `on`, scaled by 10¹⁰: the last fixing on or
 * before that day (a weekend or a holiday takes the working day before). `null` when the table
 * holds none — a currency outside the ECB list, or a day before the first stored rate.
 */
export function eurPerUnitOn(rates: RateTable, currency: string, on: CivilDate): bigint | null {
  if (currency === "EUR") return SCALE;
  const list = rates.get(currency);
  if (!list || list.length === 0 || list[0].on > on) return null;
  let low = 0;
  let high = list.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (list[middle].on <= on) low = middle;
    else high = middle - 1;
  }
  return list[low].eurPerUnit;
}

/**
 * `cents` of `from` in `to` on `on` (§1.8): `cents × eur_per_unit(from) / eur_per_unit(to)`, both
 * the last fixing on or before `on`, rounded to the cent half away from zero (as `parseCents`).
 * The same currency needs no rate and returns `cents` unchanged. A missing rate on either side is
 * `null`, never 1:1: the caller leaves that value out of a total and marks it partial.
 */
export function convertCents(
  cents: bigint,
  from: string,
  to: string,
  on: CivilDate,
  rates: RateTable,
): bigint | null {
  if (from === to) return cents;
  const source = eurPerUnitOn(rates, from, on);
  const target = eurPerUnitOn(rates, to, on);
  if (source === null || target === null) return null;
  const numerator = cents * source;
  const quotient = numerator / target;
  const remainder = numerator % target;
  const twice = (remainder < 0n ? -remainder : remainder) * 2n;
  if (twice < target) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}
