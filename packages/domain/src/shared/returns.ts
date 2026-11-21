// The returns of an amount over time (docs/design/investments.md §2.4, §4.3, D8; audit FND-4): Modified
// Dietz and the money-weighted rate (XIRR) of an account, a fund or a portfolio. Pure, and the one place of the module that works in
// floating point: a rate of return is a ratio, never an amount, and nothing here is written back.
import { addDays, type CivilDate, dayNumber, daysBetween } from "./dates";
import type { Cents } from "./money";

/** A dated amount seen from the person: money put in is negative, money taken out positive. */
interface DatedFlow {
  on: CivilDate;
  cents: Cents;
}

/** The answer: a rate, or why there is none ("not computable" in the UI). */
export type Xirr = { status: "ok"; rate: number } | { status: "none" } | { status: "multiple" };

/** The interval a rate is looked for in (§2.4): −99 % to +1000 % a year. */
const XIRR_MIN = -0.99;
const XIRR_MAX = 10;

/** Points of the scan for sign changes, evenly spaced in log(1 + r). */
const STEPS = 4000;
const TOLERANCE = 1e-10;

/**
 * XIRR (§2.4): the annual rate r for which Σ cᵢ / (1 + r)^(tᵢ / 365) = 0, with tᵢ the days from
 * the first flow. The net present value is scanned over [{@link XIRR_MIN}, {@link XIRR_MAX}] for
 * changes of sign: none means no solution, more than one means several (both "not computable");
 * exactly one is narrowed by bisection.
 */
export function xirr(flows: readonly DatedFlow[]): Xirr {
  const present = flows.filter((flow) => flow.cents !== 0n);
  if (!present.some((flow) => flow.cents < 0n) || !present.some((flow) => flow.cents > 0n)) {
    return { status: "none" };
  }
  const first = Math.min(...present.map((flow) => dayNumber(flow.on)));
  const terms = present.map((flow) => ({
    years: (dayNumber(flow.on) - first) / 365,
    amount: Number(flow.cents),
  }));
  // In log(1 + r): the discount factor is exp(−x·t), smooth and finite over the whole interval.
  const npv = (x: number) => terms.reduce((sum, term) => sum + term.amount * Math.exp(-x * term.years), 0);
  const low = Math.log1p(XIRR_MIN);
  const high = Math.log1p(XIRR_MAX);

  const brackets: [number, number][] = [];
  let previousX = low;
  let previous = npv(low);
  if (previous === 0) brackets.push([low, low]);
  for (let step = 1; step <= STEPS; step++) {
    const x = low + ((high - low) * step) / STEPS;
    const value = npv(x);
    if (value === 0) brackets.push([x, x]);
    else if (previous !== 0 && Math.sign(value) !== Math.sign(previous)) brackets.push([previousX, x]);
    previousX = x;
    previous = value;
  }
  if (brackets.length === 0) return { status: "none" };
  if (brackets.length > 1) return { status: "multiple" };

  let [a, b] = brackets[0];
  let fa = npv(a);
  while (b - a > TOLERANCE) {
    const middle = (a + b) / 2;
    const value = npv(middle);
    if (value === 0) {
      a = b = middle;
      break;
    }
    if (Math.sign(value) === Math.sign(fa)) {
      a = middle;
      fa = value;
    } else {
      b = middle;
    }
  }
  return { status: "ok", rate: Math.expm1((a + b) / 2) };
}

/** Below this average capital a rate of return says nothing (§4.3). */
export const MIN_CAPITAL_CENTS = 100n;
/** …nor below this share of the gross capital. */
export const MIN_CAPITAL_SHARE = 0.01;

/**
 * Modified Dietz (§4.3) over `[from, to]`: flows at the end of their day, weighted by the days left.
 * `null` when the average capital is ≤ 0 or below the threshold of {@link MIN_CAPITAL_CENTS} and
 * {@link MIN_CAPITAL_SHARE} of the gross capital (the start plus the money put in).
 */
export function modifiedDietz(input: {
  from: CivilDate;
  to: CivilDate;
  startCents: Cents;
  pnlCents: Cents;
  flows: readonly { on: CivilDate; cents: Cents }[];
}): { rate: number | null; averageCapital: number; gross: number } {
  const base = addDays(input.from, -1);
  const days = daysBetween(base, input.to);
  let capital = Number(input.startCents);
  let gross = Number(input.startCents > 0n ? input.startCents : 0n);
  for (const flow of input.flows) {
    capital += (Number(flow.cents) * daysBetween(flow.on, input.to)) / days;
    if (flow.cents > 0n) gross += Number(flow.cents);
  }
  const floor = Math.max(Number(MIN_CAPITAL_CENTS), MIN_CAPITAL_SHARE * gross);
  return {
    rate: capital <= 0 || capital < floor ? null : Number(input.pnlCents) / capital,
    averageCapital: capital,
    gross,
  };
}

/**
 * The return of a span between two values with the money that moved in it: Modified Dietz, and the
 * money-weighted rate over 365 days or more. `from` is the day of the first value; a flow is money
 * put in (positive) or taken out (negative). The one recipe of Funds' fund and portfolio (FND-4).
 */
export function moneyWeighted(input: {
  from: CivilDate;
  to: CivilDate;
  startCents: Cents;
  endCents: Cents;
  pnlCents: Cents;
  flows: readonly { on: CivilDate; cents: Cents }[];
}): { rate: number | null; xirr: Xirr | null } {
  const { from, to, startCents, endCents, pnlCents, flows } = input;
  const days = daysBetween(from, to);
  if (days <= 0) return { rate: null, xirr: null };
  return {
    rate: modifiedDietz({ from: addDays(from, 1), to, startCents, pnlCents, flows }).rate,
    xirr: spanXirr({ from, to, startCents, endCents, flows }),
  };
}

/**
 * The money-weighted rate between two values, `from` the day of the first: only over 365 days or
 * more, since a shorter span would be annualised from too little (§2.4).
 */
export function spanXirr(input: {
  from: CivilDate;
  to: CivilDate;
  startCents: Cents;
  endCents: Cents;
  flows: readonly { on: CivilDate; cents: Cents }[];
}): Xirr | null {
  const { from, to, startCents, endCents, flows } = input;
  if (daysBetween(from, to) < 365) return null;
  return xirr([
    { on: from, cents: -startCents },
    ...flows.map((flow) => ({ on: flow.on, cents: -flow.cents })),
    { on: to, cents: endCents },
  ]);
}

/**
 * The simple return: a gain over the capital it was made on, never annualised. Exact to a
 * billionth, from integers: no float on the way in. The return of one stretch between two values,
 * and of a fund's position against what was put in.
 */
export function simpleReturn(gainCents: Cents, capitalCents: Cents): number {
  return Number((gainCents * 1_000_000_000n) / capitalCents) / 1_000_000_000;
}
