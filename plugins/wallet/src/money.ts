/**
 * Amounts as integer cents: Wallet's figures and the contract's decimals both pass through them,
 * never through a float. The core counts in cents too, so rounding here (half-up, away from zero,
 * at the third decimal) is the rounding it has always applied to Wallet's amounts.
 */
import { WalletError } from "./failure";

const PLAIN_DECIMAL = /^([+-])?(\d+)(?:\.(\d+))?$/;
/** The largest amount a double still holds to the cent: beyond it the fallback is refused. */
const MAX_SAFE_AMOUNT = 1e15;

/** A plain decimal ("1234.5", "-0.005") as cents; exponents and symbols are not amounts. */
export function parseCents(input: string): bigint {
  const match = PLAIN_DECIMAL.exec(input.trim());
  if (!match) throw new WalletError("payload", "not a plain decimal amount");
  const [, sign, whole, fraction = ""] = match;
  const firstThree = `${fraction}000`.slice(0, 3);
  let cents = BigInt(whole) * 100n + BigInt(firstThree.slice(0, 2));
  if (Number(firstThree[2]) >= 5) cents += 1n;
  return sign === "-" ? -cents : cents;
}

/** The contract's decimal text of an amount: "1234.56", "-0.05". */
export function centsToDecimal(cents: bigint): string {
  const negative = cents < 0n;
  const size = negative ? -cents : cents;
  const fraction = (size % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${size / 100n}.${fraction}`;
}

function centsFromNumber(value: number): bigint {
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_SAFE_AMOUNT) {
    throw new WalletError("payload", "not a representable amount");
  }
  return parseCents(value.toFixed(6));
}

/**
 * A Wallet amount as cents. Every number of a Wallet answer reaches here as the text Wallet sent
 * (`parseJsonPreservingNumbers`), so "2615.39" is read digit by digit. Two inputs take the lossy
 * route, documented rather than hidden: a genuine number (a runtime without the source text of
 * JSON numbers) and exponent notation ("1e3"), which is legal JSON; both go through the number's
 * fixed decimal representation, so `0.1 + 0.2` is 30 cents and not 30.000000000000004.
 */
export function walletAmountToCents(value: string | number): bigint {
  if (typeof value === "number") return centsFromNumber(value);
  const text = value.trim();
  if (PLAIN_DECIMAL.test(text)) return parseCents(text);
  const asNumber = Number(text);
  if (text === "" || Number.isNaN(asNumber)) throw new WalletError("payload", "not a Wallet amount");
  return centsFromNumber(asNumber);
}
