/**
 * Integer-cent money math. Postgres `numeric` arrives as a string
 * ("1234.56"), so every calc entry point accepts `string | number | null`
 * and normalises here; euros only ever reappear at the boundary.
 */

export type MoneyInput = string | number | null | undefined;

/** Plain decimal only — Italian "1.234,56" must go through parseItalianNumber first. */
const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?$/;

function centsFromDecimal(raw: string): number | null {
  const m = DECIMAL.exec(raw.trim());
  if (!m) return null;
  const [, sign = "", int = "", frac = ""] = m;
  if (int === "" && frac === "") return null;
  const whole = Number(int === "" ? "0" : int);
  if (!Number.isSafeInteger(whole)) return null;
  const padded = `${frac}000`.slice(0, 3);
  const cents = whole * 100 + Number(padded.slice(0, 2)) + (Number(padded.charAt(2)) >= 5 ? 1 : 0);
  return sign === "-" ? -cents : cents;
}

export function toCents(value: MoneyInput): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // toFixed first so 0.1 + 0.2 lands on 30 cents, not 30.000000000000004.
    return centsFromDecimal(value.toFixed(6));
  }
  return centsFromDecimal(value);
}

export function fromCents(cents: number): number;
export function fromCents(cents: number | null | undefined): number | null;
export function fromCents(cents: number | null | undefined): number | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  return Math.round(cents) / 100;
}

/** Sums whatever parses; unparseable and nullish entries contribute nothing. */
export function sumCents(values: Iterable<MoneyInput>): number {
  let total = 0;
  for (const v of values) total += toCents(v) ?? 0;
  return total;
}

export function roundEur(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toFixed(decimals));
}
