import { fromCents, toCents } from "@/lib/calc/money";

/**
 * Internal fixed-point scale: 1e12, i.e. 12 decimal digits of precision -
 * exactly enough headroom above the 6-decimal `numeric(16,6)` accrual
 * columns (see the interests migration) that dividing by a day count and
 * multiplying by a rate can never itself introduce a rounding error large
 * enough to flip a cent-boundary decision. `BigInt` stands in for Python's
 * `Decimal`, which this codebase has no equivalent dependency for.
 */
const SCALE = 1_000_000_000_000n;
const CENT_SCALE = SCALE / 100n;
const DECIMAL_SCALE_DIGITS = 12;

/**
 * A plain, single-dot decimal number with an optional leading "-" — the
 * shape a Postgres `numeric` column always renders as (e.g. "1234.56",
 * "0", "-100.00"). Deliberately stricter than it needs to be for any real
 * caller: an empty string, a bare "-", "1.2.3", "1e-3" or "1,5" all fail
 * this, rather than being silently coerced into some other number.
 */
const UNSIGNED_DECIMAL_RE = /^\d+(?:\.\d+)?$/;

function tryParseDecimal(value: string): bigint | null {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = negative ? trimmed.slice(1) : trimmed;
  if (!UNSIGNED_DECIMAL_RE.test(unsigned)) return null;
  const [intPart, fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "0".repeat(DECIMAL_SCALE_DIGITS)).slice(0, DECIMAL_SCALE_DIGITS);
  const n = BigInt(intPart!) * SCALE + BigInt(frac);
  return negative ? -n : n;
}

/**
 * Parses a required decimal field (balance, annualRate, taxRate). An absent
 * or malformed value is a missing balance basis, not a zero — constraint:
 * "never invent financial data" — so this throws rather than defaulting to
 * `0n` the way an empty-string `parseDecimal("")` used to.
 */
function parseRequiredDecimal(fieldName: string, value: string): bigint {
  const parsed = tryParseDecimal(value);
  if (parsed === null) {
    throw new Error(`dailyInterest: "${fieldName}" is not a valid decimal amount: ${JSON.stringify(value)}`);
  }
  return parsed;
}

/**
 * Parses the prior day's carry. Unlike the required fields above, an empty
 * string is meaningful here — it is how the first day of a rule (no prior
 * carry yet) is represented — and parses as exactly zero. Anything else
 * that fails to parse still throws; only the empty case is lenient.
 */
function parseCarry(value: string): bigint {
  if (value.trim() === "") return 0n;
  return parseRequiredDecimal("carry", value);
}

/** Renders a scaled `bigint` as a plain decimal string, truncated to `decimals` places. */
function formatDecimal(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMAL_SCALE_DIGITS, "0").slice(0, decimals);
  const sign = negative ? "-" : "";
  return decimals > 0 ? `${sign}${whole}.${frac}` : `${sign}${whole}`;
}

export interface DailyAccrualInput {
  balance: string;
  annualRate: string;
  taxRate: string;
  dayCount: 360 | 365;
  carry: string;
}

export interface DailyAccrualResult {
  gross: string;
  tax: string;
  net: string;
  carryAfter: string;
}

/**
 * ACT/day-count simple daily accrual, ported from `interest.py`'s
 * `daily_interest` (Wallet Manager, `app/interest.py:192-200`):
 *
 *   gross_raw = balance * annualRate / dayCount
 *   net_raw   = gross_raw * (1 - taxRate) + priorCarry
 *   amount    = round_half_up(net_raw, cents); if amount < 0: amount = 0
 *   carry     = net_raw - amount
 *
 * Tax is withheld on the gross accrual before the day's carry is folded in
 * and before rounding, exactly as the legacy script does it. The actual
 * HALF_UP-to-the-cent rounding is delegated to this codebase's established
 * `toCents` (src/lib/calc/money.ts) rather than hand-rolled: it already
 * rounds ties away from zero for negative values - matching Python's
 * `ROUND_HALF_UP` exactly - and parses the decimal string with a regex,
 * never `Number()`. (`toCents` itself funnels the whole-currency part
 * through a JS `number`, exact below roughly 9.0×10¹³ cents — about
 * €900 billion — and unbounded-but-inexact above that; no realistic
 * balance here approaches it, but nothing enforces the ceiling.)
 * A result that would post negative (only reachable from a negative
 * balance, since `annualRate` and `taxRate` are validated non-negative
 * below) floors to zero, matching the legacy script; the carry returned is
 * computed from that floored amount, so - as in `interest.py` - the full
 * raw remainder rolls forward untouched whenever nothing posts.
 *
 * `balance` may be negative (a real overdraft); `annualRate` and `taxRate`
 * may not — a negative rate, or a `taxRate` outside `[0, 1]`, is rejected
 * rather than silently run. The legacy script never validated this either
 * (`numeric(10,6)` doesn't prevent it, and nothing about the rule config
 * says a negative rate is ever intended), and were it allowed, a negative
 * `totalRaw` would floor to `net: "0.00"` and roll the negative remainder
 * forward forever, silently consuming every later positive period with no
 * signal anywhere that anything is wrong — a rule-configuration typo (a
 * stray "-", or a tax rate typed as "1.26" instead of "0.26") is a far more
 * likely cause than an intentional negative-interest rule, so this rejects
 * up front instead of letting that run quietly.
 */
export function dailyInterest(input: DailyAccrualInput): DailyAccrualResult {
  const balance = parseRequiredDecimal("balance", input.balance);
  const annualRate = parseRequiredDecimal("annualRate", input.annualRate);
  const taxRate = parseRequiredDecimal("taxRate", input.taxRate);
  const priorCarry = parseCarry(input.carry);

  if (annualRate < 0n) {
    throw new Error(`dailyInterest: annualRate must not be negative, got "${input.annualRate}"`);
  }
  if (taxRate < 0n || taxRate > SCALE) {
    throw new Error(`dailyInterest: taxRate must be between 0 and 1, got "${input.taxRate}"`);
  }

  const grossRaw = (balance * annualRate) / SCALE / BigInt(input.dayCount);
  const netFactor = SCALE - taxRate;
  const netRaw = (grossRaw * netFactor) / SCALE;
  const totalRaw = netRaw + priorCarry;
  const taxWithheld = grossRaw - netRaw;

  const totalRawDecimal = formatDecimal(totalRaw, DECIMAL_SCALE_DIGITS);
  const roundedCents = toCents(totalRawDecimal);
  if (roundedCents === null) {
    // Unreachable for well-formed inputs: formatDecimal always emits a
    // plain, fully-signed decimal string that toCents' parser accepts.
    throw new Error(`dailyInterest: could not round accrual total "${totalRawDecimal}" to cents`);
  }
  const netCents = Math.max(roundedCents, 0);
  const carryAfter = totalRaw - BigInt(netCents) * CENT_SCALE;

  return {
    gross: formatDecimal(grossRaw, 6),
    tax: formatDecimal(taxWithheld, 6),
    net: fromCents(netCents).toFixed(2),
    carryAfter: formatDecimal(carryAfter, 6),
  };
}

export interface ProjectionPoint {
  date: string;
  net: string;
  cumulativeNet: string;
}

/**
 * Projects forward assuming the balance stays constant - a documented
 * simplification (spec: "projections from current balance and rule").
 * Each day's carry rolls into the next via `dailyInterest`; the cumulative
 * total is accumulated in integer cents via `toCents`/`fromCents`, never
 * through `Number() * 100`.
 *
 * `fromDate` must represent a UTC calendar date — the way a `"YYYY-MM-DD"`
 * string parses via `new Date(...)`, per the JS spec. Each day is stepped
 * by exactly 86,400,000ms and every label is read back via `toISOString`,
 * which is UTC-only; a caller who instead builds `fromDate` with the local
 * `Date` constructor (e.g. `new Date(2026, 8, 1)`) in a positive-UTC-offset
 * timezone gets every projected date label one calendar day earlier than
 * intended, because the information distinguishing "midnight here" from
 * "midnight UTC" is already gone by the time a plain `Date` reaches here.
 */
export function projectInterest(
  input: { balance: string; annualRate: string; taxRate: string; dayCount: 360 | 365 },
  fromDate: Date,
  days: number,
): ProjectionPoint[] {
  const points: ProjectionPoint[] = [];
  let carry = "0";
  let cumulativeCents = 0;
  for (let i = 0; i < days; i += 1) {
    const day = dailyInterest({ ...input, carry });
    carry = day.carryAfter;
    const dayCents = toCents(day.net);
    if (dayCents === null) {
      // Unreachable: day.net is always our own fromCents(...).toFixed(2) output.
      throw new Error(`projectInterest: could not parse projected net "${day.net}"`);
    }
    cumulativeCents += dayCents;
    const date = new Date(fromDate.getTime() + i * 86_400_000);
    points.push({
      date: date.toISOString().slice(0, 10),
      net: day.net,
      cumulativeNet: fromCents(cumulativeCents).toFixed(2),
    });
  }
  return points;
}
