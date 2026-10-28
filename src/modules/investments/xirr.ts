// src/modules/investments/xirr.ts — the money-weighted return of an account or of the portfolio
// (docs/design/investments.md §2.4, D8). Pure, and the one place of the module that works in
// floating point: a rate of return is a ratio, never an amount, and nothing here is written back.
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";

/** A dated amount seen from the person: money put in is negative, money taken out positive. */
export interface DatedFlow {
  on: CivilDate;
  cents: Cents;
}

/** The answer: a rate, or why there is none ("not computable" in the UI). */
export type Xirr = { status: "ok"; rate: number } | { status: "none" } | { status: "multiple" };

/** The interval a rate is looked for in (§2.4): −99 % to +1000 % a year. */
export const XIRR_MIN = -0.99;
export const XIRR_MAX = 10;

/** Points of the scan for sign changes, evenly spaced in log(1 + r). */
const STEPS = 4000;
const TOLERANCE = 1e-10;
const DAY_MS = 86_400_000;

function dayNumber(on: CivilDate): number {
  return Date.parse(`${on}T00:00:00Z`) / DAY_MS;
}

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
