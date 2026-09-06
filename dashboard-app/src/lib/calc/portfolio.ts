import type { MonthPoint } from "@/lib/contracts";
import { monthKeyOf } from "@/lib/time";
import { fromCents, toCents, type MoneyInput } from "./money";

function monthlyReturn(input: { valueM: MoneyInput; valuePrev: MoneyInput; depositsInM?: MoneyInput }): { pct: number | null } {
  const value = toCents(input.valueM);
  const previous = toCents(input.valuePrev);
  if (value === null || previous === null) return { pct: null };
  const deposits = toCents(input.depositsInM) ?? 0;
  const denominator = previous + deposits;
  return { pct: denominator === 0 ? null : ((value - previous - deposits) / denominator) * 100 };
}

export interface FundSeries {
  key: string;
  label: string;
  /** Month-end values from balance_snapshots — the SAME series the cards read.
   * Gaps are `null`, never 0. */
  values: MonthPoint[];
  /** Net money that actually entered the fund, keyed by the month it becomes
   * visible in `values` (Cometa quarterly, Fideuram shifted one month). */
  credited: Map<string, number>;
  /** Opening capital booked before the first deposit (`fund_settings`). */
  initialCapital: MoneyInput;
}

export interface GainRow {
  month: string;
  value: number | null;
  /** Money that entered this month; on the opening row, the whole base established. */
  paidIn: number;
  /**
   * Euro gain that RECONCILES with the card: the change in the fund's cumulative
   * absolute return (value − deposited) from one month to the next. Summed over
   * every row it telescopes to `value_last − deposited_last`, i.e. the card's
   * lifetime absolute gain, to the cent.
   */
  abs: number | null;
  /** Simple-Dietz monthly percentage; `null` on the opening row. */
  pct: number | null;
  /** The fund's first funded month: a baseline position, not a scored return. */
  opening: boolean;
}

export interface GainTotal {
  abs: number;
  /** Percentage points, compounded across the scored months. */
  pct: number | null;
}

export interface PerFundGain {
  key: string;
  label: string;
  rows: GainRow[];
  total: GainTotal;
}

export interface CombinedGain {
  perFund: PerFundGain[];
  combined: GainRow[];
  combinedTotal: GainTotal;
}

function valueMapCents(values: MonthPoint[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of values) {
    const c = toCents(p.value);
    if (c !== null) out.set(monthKeyOf(p.month), c);
  }
  return out;
}

/**
 * Month-by-month gain for one fund, reconciled to the card.
 *
 * `deposited(m)` is the initial capital plus every credit up to and including m
 * — the exact figure the card divides by — so `absReturn(m) = value(m) −
 * deposited(m)` is the card's own cumulative gain at month m. Each row reports
 * the FIRST DIFFERENCE of that, `absReturn(m) − absReturn(m−1)`, which equals
 * `value_change − paid_in`. The first funded month is shown as an opening
 * baseline (its cumulative gain to date, no percentage); every later month is a
 * scored return. The euro column therefore sums to `absReturn(last)` — the
 * card's lifetime absolute gain — by construction.
 */
export function fundGain(series: FundSeries): PerFundGain {
  const valueCents = valueMapCents(series.values);
  const creditedCents = new Map<string, number>();
  for (const [m, a] of series.credited) creditedCents.set(monthKeyOf(m), toCents(a) ?? 0);

  const valueMonths = [...valueCents.keys()].sort();
  const initial = toCents(series.initialCapital) ?? 0;

  // deposited(m): initial capital carried forward, plus each credit as its
  // visible month arrives. Walk every value or credit month in order.
  const deposited = new Map<string, number>();
  {
    const axis = [...new Set([...valueMonths, ...creditedCents.keys()])].sort();
    let cum = initial;
    for (const m of axis) {
      cum += creditedCents.get(m) ?? 0;
      deposited.set(m, cum);
    }
  }
  const depositedAt = (m: string) => deposited.get(m) ?? initial;
  const absAt = (m: string) => valueCents.get(m)! - depositedAt(m);

  // Scoring starts the first month the fund actually holds a funded position:
  // Fideuram from its opening capital, Cometa once its first quarter is credited.
  const start = valueMonths.find((m) => depositedAt(m) > 0) ?? null;

  const rows: GainRow[] = [];
  let totalAbsCents = 0;
  let factor = 1;
  let scored = 0;
  let prevMonth: string | null = null;

  for (const m of valueMonths) {
    if (start === null || m < start) continue;
    const value = fromCents(valueCents.get(m)!);
    if (prevMonth === null) {
      const absCents = absAt(m);
      totalAbsCents += absCents;
      rows.push({
        month: m,
        value,
        paidIn: fromCents(depositedAt(m)),
        abs: fromCents(absCents),
        pct: null,
        opening: true,
      });
    } else {
      const absCents = absAt(m) - absAt(prevMonth);
      totalAbsCents += absCents;
      const paidCents = creditedCents.get(m) ?? 0;
      const { pct } = monthlyReturn({
        valueM: value,
        valuePrev: fromCents(valueCents.get(prevMonth)!),
        depositsInM: fromCents(paidCents),
      });
      if (pct !== null) {
        factor *= 1 + pct / 100;
        scored += 1;
      }
      rows.push({ month: m, value, paidIn: fromCents(paidCents), abs: fromCents(absCents), pct, opening: false });
    }
    prevMonth = m;
  }

  return {
    key: series.key,
    label: series.label,
    rows,
    total: {
      abs: fromCents(totalAbsCents),
      pct: scored === 0 ? null : Number(((factor - 1) * 100).toFixed(4)),
    },
  };
}

/**
 * Per-fund and combined gain across every fund.
 *
 * The combined euro column is simply the funds' euro columns added month by
 * month, so it too reconciles: it sums to the funds' lifetime gains added
 * together. The combined percentage is a portfolio simple-Dietz on the summed
 * values, scored only for months where every fund is past its own opening and
 * has a previous value — otherwise the percentage would misattribute one fund's
 * opening balance to performance.
 */
export function combinedGain(funds: FundSeries[]): CombinedGain {
  const perFund = funds.map(fundGain);
  if (perFund.length === 0) {
    return { perFund, combined: [], combinedTotal: { abs: 0, pct: null } };
  }

  const rowByMonth = perFund.map((f) => new Map(f.rows.map((r) => [r.month, r])));
  const valueMaps = funds.map((f) => valueMapCents(f.values));
  const months = [...new Set(perFund.flatMap((f) => f.rows.map((r) => r.month)))].sort();

  const combined: GainRow[] = [];
  let factor = 1;
  let scored = 0;
  let prevMonth: string | null = null;

  for (const m of months) {
    const present = rowByMonth.map((byMonth) => byMonth.get(m));
    let absCents = 0;
    let paidCents = 0;
    for (const r of present) {
      if (!r) continue;
      absCents += toCents(r.abs) ?? 0;
      paidCents += toCents(r.paidIn) ?? 0;
    }

    const allHaveValue = valueMaps.every((mp) => mp.has(m));
    const value = allHaveValue
      ? fromCents(valueMaps.reduce((s, mp) => s + mp.get(m)!, 0))
      : null;

    const everyScored = present.every((r) => r !== undefined && !r.opening);
    const havePrev = prevMonth !== null && valueMaps.every((mp) => mp.has(prevMonth!));
    let pct: number | null = null;
    if (allHaveValue && everyScored && havePrev) {
      const vNow = valueMaps.reduce((s, mp) => s + mp.get(m)!, 0);
      const vPrev = valueMaps.reduce((s, mp) => s + mp.get(prevMonth!)!, 0);
      pct = monthlyReturn({
        valueM: fromCents(vNow),
        valuePrev: fromCents(vPrev),
        depositsInM: fromCents(paidCents),
      }).pct;
      if (pct !== null) {
        factor *= 1 + pct / 100;
        scored += 1;
      }
    }

    combined.push({ month: m, value, paidIn: fromCents(paidCents), abs: fromCents(absCents), pct, opening: false });
    if (allHaveValue) prevMonth = m;
  }

  const combinedTotal: GainTotal = {
    abs: fromCents(perFund.reduce((s, f) => s + (toCents(f.total.abs) ?? 0), 0)),
    pct: scored === 0 ? null : Number(((factor - 1) * 100).toFixed(4)),
  };

  return { perFund, combined, combinedTotal };
}
