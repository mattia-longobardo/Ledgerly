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

function parseDecimal(value: string): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^-/, "");
  const [intPart = "0", fracPart = ""] = unsigned.split(".");
  const frac = (fracPart + "0".repeat(DECIMAL_SCALE_DIGITS)).slice(0, DECIMAL_SCALE_DIGITS);
  const n = BigInt(intPart || "0") * SCALE + BigInt(frac || "0");
  return negative ? -n : n;
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
 * never `Number()`. A result that would post negative (only reachable from
 * a negative balance) floors to zero, matching the legacy script; the carry
 * returned is computed from that floored amount, so - as in `interest.py` -
 * the full raw remainder rolls forward untouched whenever nothing posts.
 */
export function dailyInterest(input: DailyAccrualInput): DailyAccrualResult {
  const balance = parseDecimal(input.balance);
  const annualRate = parseDecimal(input.annualRate);
  const taxRate = parseDecimal(input.taxRate);
  const priorCarry = parseDecimal(input.carry);

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
