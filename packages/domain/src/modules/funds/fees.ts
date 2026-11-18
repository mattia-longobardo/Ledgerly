// The fees of a fund (rewrite plan, 11-standardization.md §11.2.1, extension point E3). Pure.
//
// A fee row explains and estimates. The fee written on an operation is the figure that counts: no
// number of a fund is recomputed from this list once an operation says what was charged. The list
// is read in three places only — the fee proposed for a new contribution, the fee estimated for a
// payslip period that no operation has confirmed yet, and the yearly cost on assets, shown and
// never subtracted because it is already inside the value.
import type { CivilDate } from "../../platform/dates";
import type { Cents } from "../../platform/money";
import type { AccrualPeriod, PayrollComponent } from "./sources";

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

export interface FeeLike {
  basis: FeeBasis;
  amountCents: Cents | null;
  /** A fraction as text ("0.004500" is 0,45 %); `null` for a fixed amount. */
  rate: string | null;
  period: FeePeriod | null;
  /** The source the fee is taken from; `null` when it applies to every source. */
  sourceId: string | null;
  component: PayrollComponent | null;
  validFrom: CivilDate | null;
  validTo: CivilDate | null;
}

/** Whether a fee is in force on a day. */
export function feeValidOn(fee: Pick<FeeLike, "validFrom" | "validTo">, on: CivilDate): boolean {
  return (fee.validFrom === null || fee.validFrom <= on) && (fee.validTo === null || fee.validTo >= on);
}

const appliesTo = (fee: FeeLike, sourceId: string | null) =>
  fee.sourceId === null || fee.sourceId === sourceId;

const RATE_SCALE = 1_000_000n;

/** A fraction as text → millionths, exactly. */
function microRate(rate: string): bigint {
  const [whole, fraction = ""] = rate.split(".");
  return BigInt(whole || "0") * RATE_SCALE + BigInt((fraction + "000000").slice(0, 6));
}

/** A percentage of an amount, half up. */
export function rateOf(amountCents: Cents, rate: string): Cents {
  return (amountCents * microRate(rate) + RATE_SCALE / 2n) / RATE_SCALE;
}

const MONTHS: Record<FeePeriod, number> = { month: 1, quarter: 3, year: 12 };

/**
 * The fee taken from one contribution of a source, as the list says it: every fee "on each
 * contribution" in force that day. `null` when the list has no such fee, or when the fees exceed
 * the amount: the fee is then unknown, never a zero — it is the person who knows it.
 */
export function contributionFee(
  fees: readonly FeeLike[],
  input: { on: CivilDate; chargedCents: Cents; sourceId: string | null },
): Cents | null {
  const rows = fees.filter(
    (fee) => fee.basis === "per_contribution" && feeValidOn(fee, input.on) && appliesTo(fee, input.sourceId),
  );
  if (rows.length === 0) return null;
  const total = rows.reduce<Cents>(
    (sum, fee) => sum + (fee.amountCents ?? (fee.rate === null ? 0n : rateOf(input.chargedCents, fee.rate))),
    0n,
  );
  return total <= input.chargedCents ? total : null;
}

/**
 * What a payroll source's transfers are estimated to cost while no operation says what was charged:
 * the joining fees, taken once from the enrolment quotas, and the recurring fees brought to one
 * period of the source. The two figures the period engine nets a payslip period with.
 */
export interface PeriodFees {
  enrollmentCents: Cents;
  /** Per accrual period of the source. The engine reads it as the fee of each transfer. */
  quarterCents: Cents;
}

export const NO_PERIOD_FEES: PeriodFees = { enrollmentCents: 0n, quarterCents: 0n };

/**
 * The estimate of a payroll source's fees from the list, on a day. Only fixed amounts count: a
 * percentage of a transfer nobody has seen is not estimated. A recurring fee stated for another
 * span is brought to the source's period by the months each holds (12 € a year is 3 € a quarter).
 */
export function periodFees(
  fees: readonly FeeLike[],
  input: { sourceId: string; period: AccrualPeriod; on: CivilDate },
): PeriodFees {
  let enrollmentCents = 0n;
  let quarterCents = 0n;
  for (const fee of fees) {
    if (fee.amountCents === null || !feeValidOn(fee, input.on) || !appliesTo(fee, input.sourceId)) continue;
    if (fee.basis === "one_off") enrollmentCents += fee.amountCents;
    if (fee.basis === "periodic" && fee.period !== null) {
      quarterCents += (fee.amountCents * BigInt(MONTHS[input.period])) / BigInt(MONTHS[fee.period]);
    }
  }
  return { enrollmentCents, quarterCents };
}

/**
 * The yearly cost on the assets, estimated on a value: every fee "on assets" in force that day,
 * brought to a year. `null` when the list has none. It is already inside the value of the fund, so
 * it is shown and never subtracted.
 */
export function assetsCost(
  fees: readonly FeeLike[],
  valueCents: Cents,
  on: CivilDate,
): { cents: Cents; rate: number } | null {
  const rows = fees.filter((fee) => fee.basis === "on_assets" && fee.rate !== null && feeValidOn(fee, on));
  if (rows.length === 0) return null;
  let yearly = 0n;
  for (const fee of rows) yearly += (microRate(fee.rate!) * 12n) / BigInt(MONTHS[fee.period ?? "year"]);
  return {
    cents: (valueCents * yearly + RATE_SCALE / 2n) / RATE_SCALE,
    rate: Number(yearly) / Number(RATE_SCALE),
  };
}

const BASIS_ORDER: Record<FeeBasis, number> = {
  one_off: 0,
  per_contribution: 1,
  periodic: 2,
  on_assets: 3,
  per_request: 4,
};

/** The list as the page shows it: the fees in force first, by basis, then by name; the expired apart. */
export function arrangeFees<T extends Pick<FeeLike, "basis" | "validTo"> & { label: string }>(
  fees: readonly T[],
  todayOn: CivilDate,
): { current: T[]; expired: T[] } {
  const ordered = [...fees].sort(
    (a, b) => BASIS_ORDER[a.basis] - BASIS_ORDER[b.basis] || a.label.localeCompare(b.label),
  );
  return {
    current: ordered.filter((fee) => fee.validTo === null || fee.validTo >= todayOn),
    expired: ordered.filter((fee) => fee.validTo !== null && fee.validTo < todayOn),
  };
}
