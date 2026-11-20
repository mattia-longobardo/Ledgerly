import { type Cents, parseCents } from "@ledgerly/format/cents";
import type { CivilDate } from "./dates";

export { type Cents, centsToDecimal, parseCents } from "@ledgerly/format/cents";

const PLAIN_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SAFE_AMOUNT = 1e15;

/** Converts a JSON number from a provider through its fixed decimal representation. */
export function centsFromNumber(value: number): Cents {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SAFE_AMOUNT) {
    throw new RangeError(`Not a representable amount: ${value}`);
  }
  return parseCents(value.toFixed(6));
}

/**
 * Sums amounts where null means "unknown". The total is null only when no
 * value is known; `partial` says whether any value was unknown, so a partial
 * total is never presented as a complete one.
 */
export function sumCents(values: readonly (Cents | null)[]): { total: Cents | null; partial: boolean } {
  let total: Cents | null = null;
  let partial = false;
  for (const value of values) {
    if (value === null) {
      partial = true;
      continue;
    }
    total = (total ?? 0n) + value;
  }
  return { total, partial };
}

/** An amount with its currency: what a total of movements is made of (audit TR-4). */
interface Money {
  cents: Cents;
  currency: string;
}

/** An amount and the day it belongs to, whose rate converts it; `null` when it needs none. */
export interface DatedMoney {
  money: Money;
  on: CivilDate | null;
}

/** `money` in the target currency at the rate of `on`, or `null` when no rate is known. */
export type Converter = (money: Money, on: CivilDate | null) => Cents | null;

/** A total met an amount in another currency and had no way to convert it. */
export class MixedCurrencyError extends Error {
  constructor(
    readonly into: string,
    readonly found: string,
  ) {
    super(`Cannot add ${found} to a total in ${into} without a conversion`);
    this.name = "MixedCurrencyError";
  }
}

/**
 * The one sum of amounts in currencies (audit TR-4, TRX-2): an amount in `into` is added as it is;
 * any other goes through `convert`, and without one the mix is refused. A conversion with no rate
 * (`null`) leaves that amount out and makes the total `partial`, as the accounts' totals do.
 */
export function sumMoney(
  amounts: Iterable<DatedMoney>,
  into: string,
  convert?: Converter,
): { total: Cents; partial: boolean } {
  let total = 0n;
  let partial = false;
  for (const { money, on } of amounts) {
    if (money.currency === into) {
      total += money.cents;
      continue;
    }
    if (!convert) throw new MixedCurrencyError(into, money.currency);
    const converted = convert(money, on);
    if (converted === null) partial = true;
    else total += converted;
  }
  return { total, partial };
}

/**
 * A plain decimal string ("12.5", "-0.000001") as an integer of `scale` decimals, rounded half away
 * from zero past them. Anything else — a comma, an exponent, a symbol — is a `RangeError`: callers
 * normalise first.
 */
export function parseDecimal(input: string, scale: number): bigint {
  const match = PLAIN_DECIMAL.exec(input.trim());
  if (!match) throw new RangeError(`Not a plain decimal: "${input}"`);
  const [, sign, whole, fraction = ""] = match;
  const kept = fraction.padEnd(scale + 1, "0");
  let value = BigInt(whole) * 10n ** BigInt(scale) + BigInt(kept.slice(0, scale) || "0");
  if (Number(kept[scale]) >= 5) value += 1n;
  return sign === "-" ? -value : value;
}

/** The canonical decimal string of a fixed-point integer, without trailing zeros: "12.5", "-3". */
export function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const unit = 10n ** BigInt(scale);
  const fraction = (abs % unit).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${abs / unit}${fraction ? `.${fraction}` : ""}`;
}

/** `numerator / denominator` rounded half away from zero, for any signs. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const rounded = (n % d) * 2n >= d ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/**
 * `part` as a whole percentage of `whole`, rounded half up on the integer cents (`part × 200 + whole`
 * over `whole × 2`, as the budgets have always rounded); past 100 when beyond; 0 without a positive
 * whole. The one rule of a budget's and a pocket's progress.
 */
export function wholePercent(part: bigint, whole: bigint): number {
  return whole <= 0n ? 0 : Number((part * 200n + whole) / (whole * 2n));
}

/**
 * A percentage as typed, already in plain decimal form ("2.75", "26"), as the fraction a rate
 * column stores ("0.0275"), exactly: the point moves two places, no float. Up to four decimals of a
 * percent (six of the fraction).
 */
export function percentToFraction(plain: string): string {
  const match = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(plain.trim());
  if (!match) throw new RangeError(`Not a percentage: "${plain}"`);
  const [, whole, decimals = ""] = match;
  const digits = (whole.padStart(3, "0") + decimals.padEnd(4, "0")).replace(/^0+(?=\d)/, "");
  const scaled = BigInt(digits); // hundredths of a basis point: the fraction × 10⁶
  const fraction = scaled.toString().padStart(7, "0");
  return `${fraction.slice(0, -6)}.${fraction.slice(-6)}`;
}

/** The absolute value of an integer amount: cents, units or any fixed point. */
export function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/**
 * `part` as a share of `whole`: the one rule behind every share of a total (audit TRX-3). `null`
 * when either side is unknown or the whole is zero, rather than a misleading 0 % or a share of
 * infinity. Plain, it is the exact fraction (`0.25`), signs kept. With `percentDecimals` it is a
 * percentage truncated to that many decimals, worked out on the integer cents so a rounding cannot
 * drift (spec §4.3).
 */
export function share(part: Cents | null, whole: Cents | null, percentDecimals?: number): number | null {
  if (part === null || whole === null || whole === 0n) return null;
  if (percentDecimals === undefined) return Number(part) / Number(whole);
  const scale = 10n ** BigInt(percentDecimals);
  return Number((part * 100n * scale) / whole) / Number(scale);
}
