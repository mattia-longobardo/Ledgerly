// Fees as data (rewrite plan, 10-modularity.md §10.11, extension point E3): the kinds of a fee, when
// it is in force and what a rate of an amount is. Pure; a module keeps its own fees in its tables.
import type { CivilDate } from "./dates";
import type { Cents } from "./money";

export const FEE_BASES = ["one_off", "per_contribution", "periodic", "on_assets", "per_request"] as const;
export type FeeBasis = (typeof FEE_BASES)[number];

export const FEE_PERIODS = ["month", "quarter", "year"] as const;
export type FeePeriod = (typeof FEE_PERIODS)[number];

/** The bases that need a period: a fee paid at intervals, and a yearly percentage of the assets. */
export const needsPeriod = (basis: FeeBasis): boolean => basis === "periodic" || basis === "on_assets";

/** A percentage is the only form of a fee on assets; joining and a request cost an amount. */
export function feeModes(basis: FeeBasis): readonly ("amount" | "rate")[] {
  if (basis === "on_assets") return ["rate"];
  if (basis === "one_off" || basis === "per_request") return ["amount"];
  return ["amount", "rate"];
}

/** A fee as data (E3): what it is charged on, an amount or a rate, how often, and when it is in force. */
export interface FeeRule {
  basis: FeeBasis;
  amountCents: Cents | null;
  /** A fraction as text ("0.004500" is 0,45 %); `null` for a fixed amount. */
  rate: string | null;
  period: FeePeriod | null;
  validFrom: CivilDate | null;
  validTo: CivilDate | null;
}

/** Whether a fee is in force on a day. */
export function feeValidOn(fee: Pick<FeeRule, "validFrom" | "validTo">, on: CivilDate): boolean {
  return (fee.validFrom === null || fee.validFrom <= on) && (fee.validTo === null || fee.validTo >= on);
}

export const RATE_SCALE = 1_000_000n;

/** A fraction as text → millionths, exactly. */
export function microRate(rate: string): bigint {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole || "0") * RATE_SCALE + BigInt((fraction + "000000").slice(0, 6));
}

/** A percentage of an amount, half up. */
export function rateOf(amountCents: Cents, rate: string): Cents {
  return (amountCents * microRate(rate) + RATE_SCALE / 2n) / RATE_SCALE;
}
