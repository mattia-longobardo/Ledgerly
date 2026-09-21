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
