/**
 * Quantity arithmetic for time off.
 *
 * Every quantity in this module — hours, days, fractions — is a decimal string
 * with two places, exactly as Postgres hands `numeric(8,2)` back. The
 * conversions live here and nowhere else (Phase 7 constraint), and they are
 * done in `BigInt` hundredths so a year of half days never drifts the way a
 * float sum does. Same helper shape as `src/modules/funds/domain/totals.ts`.
 */

const DECIMAL_RE = /^(-?)(\d+)(?:\.(\d+))?$/;

/** "12.34" → 1234n. Throws on anything that is not a plain decimal. */
function hundredths(value: string): bigint {
  const match = DECIMAL_RE.exec(value.trim());
  if (!match) throw new Error(`not a decimal: ${value}`);
  const [, sign, integer, fraction = ""] = match;
  return BigInt(`${sign}${integer}${(fraction + "00").slice(0, 2)}`);
}

/** 1234n → "12.34". */
function format(value: bigint): string {
  const negative = value < 0n;
  const absolute = (negative ? -value : value).toString().padStart(3, "0");
  return `${negative ? "-" : ""}${absolute.slice(0, -2)}.${absolute.slice(-2)}`;
}

/**
 * Divide in hundredths, rounding half away from zero — the same rule a payslip
 * uses, and the only one that keeps `toDays(toHours(x))` stable.
 */
function divide(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("hoursPerDay must not be zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = (2n * a + b) / (2n * b);
  return negative ? -quotient : quotient;
}

/** `toDays("16.00", "8.00")` → `"2.00"`. */
export function toDays(hours: string, hoursPerDay: string): string {
  return format(divide(hundredths(hours) * 100n, hundredths(hoursPerDay)));
}

/** `toHours("2.00", "8.00")` → `"16.00"`. */
export function toHours(days: string, hoursPerDay: string): string {
  return format(divide(hundredths(days) * hundredths(hoursPerDay), 100n));
}

/**
 * Adds two optional quantities. `null` means "no figure", not zero — R7-4's
 * rule that a missing balance renders as "—" starts here: `null + null` stays
 * `null` rather than inventing `"0.00"`.
 */
export function addQuantity(a: string | null, b: string | null): string | null {
  if (a === null && b === null) return null;
  return format(hundredths(a ?? "0.00") + hundredths(b ?? "0.00"));
}

/** The hours one event of this fraction consumes. `("0.50", "8.00")` → `"4.00"`. */
export function quantityFromFraction(fraction: "1.00" | "0.50", hoursPerDay: string): string {
  return toHours(fraction, hoursPerDay);
}
