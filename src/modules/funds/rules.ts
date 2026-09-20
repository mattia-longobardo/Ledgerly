import { type CivilDate, daysBetween, lastDayOfMonth, type MonthKey, monthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";

export const FUND_TYPES = ["pac", "pension"] as const;
export const FUND_STATES = ["active", "archived"] as const;
export const VALUATION_SOURCES = ["manual", "import"] as const;
export const DEPOSIT_SOURCES = ["manual", "rule"] as const;

export type FundType = (typeof FUND_TYPES)[number];
export type FundState = (typeof FUND_STATES)[number];
export type ValuationSource = (typeof VALUATION_SOURCES)[number];
export type DepositSource = (typeof DEPOSIT_SOURCES)[number];

export interface DepositLike {
  on: CivilDate;
  chargedCents: Cents;
  /** `null` while the fee is unknown. */
  feeCents: Cents | null;
}

export interface FundMetrics {
  /** What left the bank: the deposits as debited. */
  paidInCents: Cents;
  /** The fees known. */
  feesCents: Cents;
  /** What reached the fund; the known part when a fee is unknown (`investedPartial`). */
  investedCents: Cents;
  investedPartial: boolean;
  valueCents: Cents | null;
  /** Value − paid in (plan F4 §3.6.5): the fees are a cost of the plan. */
  gainCents: Cents | null;
  gainFraction: number | null;
}

/** A fraction of two amounts as a number, from integers: exact to a millionth, no float on the way in. */
function ratio(part: Cents, whole: Cents): number {
  return Number((part * 1_000_000_000n) / whole) / 1_000_000_000;
}

/** Spec §7.7 PAC metrics: paid in, value, gain and cumulative %, with the fees apart. */
export function fundMetrics(deposits: readonly DepositLike[], valueCents: Cents | null): FundMetrics {
  let paidIn = 0n;
  let fees = 0n;
  let invested = 0n;
  let partial = false;
  for (const deposit of deposits) {
    paidIn += deposit.chargedCents;
    if (deposit.feeCents === null) partial = true;
    else {
      fees += deposit.feeCents;
      invested += deposit.chargedCents - deposit.feeCents;
    }
  }
  const gain = valueCents === null ? null : valueCents - paidIn;
  return {
    paidInCents: paidIn,
    feesCents: fees,
    investedCents: invested,
    investedPartial: partial,
    valueCents,
    gainCents: gain,
    gainFraction: gain === null || paidIn === 0n ? null : ratio(gain, paidIn),
  };
}

/**
 * The month's return by Simple Dietz (spec §7.7): `(V − Vprev − flows) / (Vprev + flows)`, the
 * flows being what was paid in during the month. Unknown without both ends, or on nothing invested.
 */
export function simpleDietz(previous: Cents | null, value: Cents | null, flows: Cents): number | null {
  if (previous === null || value === null) return null;
  const base = previous + flows;
  if (base <= 0n) return null;
  return ratio(value - previous - flows, base);
}

/**
 * One return per month of `months`. `ends` holds the value at the end of the month **before** the
 * first, then one per month, so `ends.length === months.length + 1`.
 */
export function monthlyReturns(
  months: readonly MonthKey[],
  ends: readonly (Cents | null)[],
  flowsByMonth: ReadonlyMap<MonthKey, Cents>,
): (number | null)[] {
  // `?? null`: a fund younger than the window has fewer ends than months, and a missing end is an
  // unknown month, not a zero — reading past the array once cost a crashed page (2026-09-20).
  return months.map((month, index) =>
    simpleDietz(ends[index] ?? null, ends[index + 1] ?? null, flowsByMonth.get(month) ?? 0n),
  );
}

/** The design's footer of the chart: best, worst, positive months, and the months compounded. */
export function returnStats(returns: readonly (number | null)[]): {
  best: number | null;
  worst: number | null;
  positive: number;
  counted: number;
  compounded: number | null;
} {
  const known = returns.filter((value): value is number => value !== null);
  if (known.length === 0) return { best: null, worst: null, positive: 0, counted: 0, compounded: null };
  return {
    best: Math.max(...known),
    worst: Math.min(...known),
    positive: known.filter((value) => value > 0).length,
    counted: known.length,
    compounded: known.reduce((product, value) => product * (1 + value), 1) - 1,
  };
}

/** What was paid in by the end of each month (the "paid in" line of the charts). */
export function cumulativeAt(deposits: readonly DepositLike[], months: readonly MonthKey[]): Cents[] {
  return months.map((month) => {
    const end = lastDayOfMonth(month);
    return deposits
      .filter((deposit) => deposit.on <= end)
      .reduce<Cents>((sum, deposit) => sum + deposit.chargedCents, 0n);
  });
}

/** The deposits of each month, added up by the day they were charged. */
export function flowsByMonth(deposits: readonly DepositLike[]): Map<MonthKey, Cents> {
  const flows = new Map<MonthKey, Cents>();
  for (const deposit of deposits) {
    const month = monthKey(deposit.on);
    flows.set(month, (flows.get(month) ?? 0n) + deposit.chargedCents);
  }
  return flows;
}

/* Where the fund is heading (owner, 2026-09-20) */

/**
 * The rates a projection is drawn at. They are **hypotheses**, named as such on screen: nothing
 * here claims the fund will return them. The fund's own measured rate joins them when there is
 * enough history to annualise one honestly ({@link annualisedOverPeriods}).
 */
export const FORECAST_RATES = [0.02, 0.04, 0.06] as const;

/** How far ahead the table looks, in years. */
export const FORECAST_YEARS = [1, 3, 5, 10] as const;

/**
 * The least history that may be brought to a year. Annualising a good quarter into "+241 % a year"
 * is how a projection starts lying; under this much, the rate is `null` and the page says so
 * instead of guessing ({@link annualisedOverPeriods}).
 */
export const MONTHS_TO_ANNUALISE = 12;

export interface ForecastRow {
  years: number;
  /** What will have been paid in, if the present rhythm holds. Needs no rate and no value. */
  paidInCents: Cents;
  /** The value at each rate, in the order the rates were given; `null` with no value to grow. */
  valueCents: (Cents | null)[];
}

/**
 * Where the fund lands, year by year, if two things hold: the money keeps going in at
 * `monthlyCents` a month and it grows at each given yearly rate. The contributions are added
 * monthly and compound from the month they land (an ordinary annuity), the present value
 * compounds for the whole span.
 *
 * Nothing is invented: with no value documented the value columns are `null` and only the paid-in
 * column is answered — which is a real answer, because the rhythm is known from the payslips.
 */
export function forecast(input: {
  valueCents: Cents | null;
  paidInCents: Cents;
  monthlyCents: Cents;
  rates: readonly number[];
  years: readonly number[];
}): ForecastRow[] {
  const monthly = Number(input.monthlyCents);
  return input.years.map((years) => {
    const months = years * 12;
    return {
      years,
      paidInCents: input.paidInCents + input.monthlyCents * BigInt(months),
      valueCents: input.rates.map((rate) => {
        if (input.valueCents === null) return null;
        const monthlyRate = (1 + rate) ** (1 / 12) - 1;
        const grown = Number(input.valueCents) * (1 + monthlyRate) ** months;
        // Σ of each month's payment compounded for the months left after it.
        const added =
          monthlyRate === 0 ? monthly * months : monthly * (((1 + monthlyRate) ** months - 1) / monthlyRate);
        return BigInt(Math.round(grown + added));
      }),
    };
  });
}

/**
 * What goes in each month from here on: the average over the last twelve months, so a fund paid
 * quarterly and one paid monthly answer the same way. `0n` when nothing went in at all.
 */
export function monthlyRhythm(flows: readonly DepositLike[], months: readonly MonthKey[]): Cents {
  if (months.length === 0) return 0n;
  const from = months[0];
  const to = lastDayOfMonth(months[months.length - 1]);
  const within = flows.filter((flow) => flow.on >= from && flow.on <= to);
  if (within.length === 0) return 0n;
  const total = within.reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
  return total / BigInt(months.length);
}

/** What a fund's projection is built from, the same way for a PAC and for a pension fund. */
export interface FundForecast {
  /** The monthly rhythm the projection runs on, read from the last twelve months. */
  monthlyCents: Cents;
  /** The fund's own yearly rate, when a year of months has been measured; `null` otherwise. */
  ownRate: number | null;
  /** The hypothesis rates the rows are drawn at, the fund's own appended when it is known. */
  rates: number[];
  rows: ForecastRow[];
}

export function fundForecast(input: {
  valueCents: Cents | null;
  paidInCents: Cents;
  flows: readonly DepositLike[];
  months: readonly MonthKey[];
  /** The fund's own yearly rate, or `null` when there is not a year of it to annualise. */
  ownRate: number | null;
}): FundForecast {
  const ownRate = input.ownRate;
  const rates = ownRate === null ? [...FORECAST_RATES] : [...FORECAST_RATES, ownRate];
  const monthlyCents = monthlyRhythm(input.flows, input.months);
  return {
    monthlyCents,
    ownRate,
    rates,
    rows: forecast({
      valueCents: input.valueCents,
      paidInCents: input.paidInCents,
      monthlyCents,
      rates,
      years: FORECAST_YEARS,
    }),
  };
}

/* The return between one documented value and the next (owner, 2026-09-20) */

/**
 * A stretch between two documented values, and what the fund did over it.
 *
 * Returns used to be computed month by month against a value *held forward* from the last
 * document. That is what produced the owner's "+150 % best month, −59 % worst": in the month a
 * quarterly credit landed the value had not moved — nobody had valued the fund — so the money paid
 * in read as a loss of its own size, and the month a valuation finally arrived collected every
 * month's growth at once. Neither number was a return.
 *
 * A return needs two **documented** ends. Between them the money paid in is subtracted, as Simple
 * Dietz asks (spec §7.7), and the stretch keeps its own dates: three months and one month are not
 * comparable as "months", and the page says which is which rather than pretending.
 */
export interface PeriodReturn {
  from: CivilDate;
  to: CivilDate;
  days: number;
  fromCents: Cents;
  toCents: Cents;
  /** What was paid in between the two, the first day excluded and the last included. */
  flowsCents: Cents;
  gainCents: Cents;
  /** Gain ÷ (value at the start + what went in), never annualised. */
  fraction: number;
}

export function periodReturns(
  points: readonly { on: CivilDate; cents: Cents }[],
  flows: readonly DepositLike[],
): PeriodReturn[] {
  const ordered = [...points].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const out: PeriodReturn[] = [];
  for (let index = 1; index < ordered.length; index += 1) {
    const start = ordered[index - 1];
    const end = ordered[index];
    const flowsCents = flows
      .filter((flow) => flow.on > start.on && flow.on <= end.on)
      .reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
    const base = start.cents + flowsCents;
    // Nothing invested over the stretch: there is no rate to speak of, so the stretch is left out.
    if (base <= 0n) continue;
    const gainCents = end.cents - start.cents - flowsCents;
    out.push({
      from: start.on,
      to: end.on,
      days: daysBetween(start.on, end.on),
      fromCents: start.cents,
      toCents: end.cents,
      flowsCents,
      gainCents,
      fraction: ratio(gainCents, base),
    });
  }
  return out;
}

/** Best, worst, how many were positive, and the whole span compounded. */
export function periodStats(periods: readonly PeriodReturn[]): {
  best: PeriodReturn | null;
  worst: PeriodReturn | null;
  positive: number;
  counted: number;
  compounded: number | null;
  days: number;
} {
  if (periods.length === 0) {
    return { best: null, worst: null, positive: 0, counted: 0, compounded: null, days: 0 };
  }
  const sorted = [...periods].sort((a, b) => a.fraction - b.fraction);
  return {
    best: sorted[sorted.length - 1],
    worst: sorted[0],
    positive: periods.filter((period) => period.fraction > 0).length,
    counted: periods.length,
    compounded: periods.reduce((product, period) => product * (1 + period.fraction), 1) - 1,
    days: periods.reduce((sum, period) => sum + period.days, 0),
  };
}

/**
 * The whole span compounded and brought to a year, for the projection. A span shorter than a year
 * says nothing about a year: {@link MONTHS_TO_ANNUALISE} months of it are the least that does.
 */
export function annualisedOverPeriods(periods: readonly PeriodReturn[]): number | null {
  const stats = periodStats(periods);
  if (stats.compounded === null || stats.days < MONTHS_TO_ANNUALISE * 30) return null;
  if (1 + stats.compounded <= 0) return null;
  return (1 + stats.compounded) ** (365 / stats.days) - 1;
}
