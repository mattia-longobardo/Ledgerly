/** Integer cents. Every amount in the app travels as Cents, never as a float. */
export type Cents = bigint;

const PLAIN_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SAFE_AMOUNT = 1e15;

/**
 * Parses a plain decimal string ("1234.5", "-0.005") into cents, rounding
 * half-up, away from zero, at the third decimal. Italian formatting,
 * exponents and currency symbols are rejected: callers normalise first.
 */
export function parseCents(input: string): Cents {
  const match = PLAIN_DECIMAL.exec(input.trim());
  if (!match) throw new RangeError(`Not a plain decimal amount: "${input}"`);
  const [, sign, whole, fraction = ""] = match;
  const firstThree = `${fraction}000`.slice(0, 3);
  let cents = BigInt(whole) * 100n + BigInt(firstThree.slice(0, 2));
  if (Number(firstThree[2]) >= 5) cents += 1n;
  return sign === "-" ? -cents : cents;
}

/** Converts a JSON number from a provider through its fixed decimal representation. */
export function centsFromNumber(value: number): Cents {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SAFE_AMOUNT) {
    throw new RangeError(`Not a representable amount: ${value}`);
  }
  return parseCents(value.toFixed(6));
}

/** The canonical decimal string of an amount: "1234.56", "-0.05". */
export function centsToDecimal(cents: Cents): string {
  const negative = cents < 0n;
  const abs = negative ? -cents : cents;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${abs / 100n}.${fraction}`;
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
