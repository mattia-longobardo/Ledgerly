import { type CivilDate, lastDayOfMonth, type MonthKey, monthKey } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { accruedTotal, awaitingCredit, type OperationLike, type QuarterStatus } from "./reconcile";
import { type Quarter } from "./rules";

/**
 * The pension fund's figures (spec §7.7; GC §1, §9.1–9.3, §12; plan F6 §3.4.7): six quantities that
 * are never interchangeable — accrued, paid in, invested, value, gain, still to be credited —, each
 * with its date. Pure. A figure that cannot be computed is `null` with the reason, never a guess.
 */

export interface MovementLike {
  operationId: string;
  compartment: string;
  units: string;
  unitPrice: string | null;
  unitPriceDate: CivilDate | null;
}

/** The value as a document or a person dated it: never "today" (GC §12). */
export interface DatedValue {
  cents: Cents;
  on: CivilDate;
  source: "statement" | "manual";
}

export interface PendingQuarter {
  year: number;
  quarter: Quarter;
  due: CivilDate | null;
  cents: Cents;
}

export type GainReason = "no_value" | "nothing_paid" | "outflows_unknown";

export interface PensionMetrics {
  value: DatedValue | null;
  /** Worker + employer + TFR of the payslips (enrolment apart). */
  accruedCents: Cents;
  /** Gross inflows of contributions, enrolment and voluntary payments (GC §9.1), up to the value's date. */
  paidInCents: Cents;
  /** Of which the enrolment fees. */
  enrollmentCents: Cents;
  /** Of which voluntary payments. */
  voluntaryCents: Cents;
  transfersInCents: Cents;
  withdrawalsCents: Cents;
  feesCents: Cents;
  feesEnrollmentCents: Cents;
  feesAssociationCents: Cents;
  feesOtherCents: Cents;
  /** Net of explicit fees: what bought units. */
  investedCents: Cents;
  /**
   * Value − paid in − transfers in + outflows (GC §9.3), over the operations up to the value's
   * date, or `null` when nothing is known to have gone in: a value is then a position, not a gain.
   */
  gainCents: Cents | null;
  /**
   * What the gain is measured against: the fund's own inflows when it has any, otherwise what the
   * transfer schedule has carried by the value's date. The figure the header prints beside the
   * gain, so the two always belong to each other.
   */
  gainBasisCents: Cents;
  /** True when that basis is the schedule's word and not the fund's own operations. */
  standsOnPayslips: boolean;
  /** Gain ÷ paid in, not annualised (GC §9.2). */
  gainFraction: number | null;
  gainReason: GainReason | null;
  pendingCents: Cents;
  pending: PendingQuarter[];
  /**
   * Accrued of the quarters whose transfer deadline has passed with no export to check them
   * against (GC §1 keeps it apart from {@link PensionMetrics.paidInCents}, which only the fund's
   * own operations feed): what the schedule in Settings says has reached the fund by now.
   */
  transferredCents: Cents;
  /** The last month of the last quarter the fund credited (GC §12 "coperte fino a"). */
  coveredUntil: MonthKey | null;
  units: string | null;
  compartments: string[];
  lastPrice: { price: string; on: CivilDate } | null;
  /** Operations dated after the value: left out of the gain, shown apart. */
  laterCents: Cents;
}

const SCALE = 1_000_000n;

/** Decimal text → millionths, exactly. */
function micro(text: string): bigint {
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace(/^[-+]/, "").split(".");
  const value = BigInt(whole || "0") * SCALE + BigInt((fraction + "000000").slice(0, 6));
  return negative ? -value : value;
}

function fromMicro(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / SCALE;
  const fraction = (abs % SCALE).toString().padStart(6, "0").slice(0, decimals);
  return `${negative ? "-" : ""}${whole}${decimals > 0 ? `.${fraction}` : ""}`;
}

/** How many decimals a unit count is printed with, by the provider and by the twins. */
export const UNIT_DECIMALS = 3;

/**
 * Units added up without inventing precision (GC §13): as many decimals as the most precise value
 * holds, the zeros `numeric(18,6)` pads them with in the database left out, and never fewer than
 * the three the provider prints.
 */
export function sumUnits(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  const decimals = Math.max(
    UNIT_DECIMALS,
    ...values.map((value) => (value.split(".")[1] ?? "").replace(/0+$/, "").length),
  );
  return fromMicro(
    values.reduce((sum, value) => sum + micro(value), 0n),
    Math.min(decimals, 6),
  );
}

export function operationUnits(movements: readonly MovementLike[]): string {
  return sumUnits(movements.map((movement) => movement.units)) ?? "0";
}

function ratio(part: Cents, whole: Cents): number {
  return Number((part * 1_000_000_000n) / whole) / 1_000_000_000;
}

const gross = (operation: OperationLike) =>
  operation.workerCents + operation.employerCents + operation.tfrCents + operation.otherCents;

export function pensionMetrics(input: {
  value: DatedValue | null;
  operations: readonly OperationLike[];
  movements: readonly MovementLike[];
  quarters: readonly QuarterStatus[];
}): PensionMetrics {
  const { value, quarters } = input;
  const until = value?.on ?? null;
  const counted = input.operations.filter((operation) => until === null || operation.operationDate <= until);
  const later = input.operations.filter((operation) => until !== null && operation.operationDate > until);
  const byClass = (classes: readonly string[], rows: readonly OperationLike[] = counted) =>
    rows.filter((operation) => classes.includes(operation.classification));
  const total = (rows: readonly OperationLike[], pick: (operation: OperationLike) => Cents) =>
    rows.reduce<Cents>((sum, operation) => sum + pick(operation), 0n);

  const inflows = byClass(["contribution", "enrollment", "voluntary"]);
  const paidIn = total(inflows, gross);
  const transfersIn = total(byClass(["transfer_in"]), gross);
  const withdrawals = byClass(["withdrawal"]);
  // An exit's gross amount is what left the position; recorded as a positive figure.
  const withdrawalsCents = total(withdrawals, (operation) => {
    const amount = gross(operation);
    return amount < 0n ? -amount : amount;
  });

  // What the schedule says has left for the fund, with no document of the fund's to confirm it
  // (GC §1 keeps it apart from what the fund's own operations say was credited).
  const transferred = quarters.filter((quarter) => quarter.status === "transferred");
  const transferredCents = transferred.reduce<Cents>(
    (sum, quarter) => sum + (accruedTotal(quarter) ?? 0n),
    0n,
  );

  /*
    What the gain is measured against. A fund with no inflow operation at all has no figure of its
    own, and measuring against a zero turned the whole position into "gain" — a fund valued at
    2 251,05 € read "+2 251,05 € · — · 0,00 € paid in" (owner, 2026-09-20). The quarters the
    schedule has already carried stand in, up to the value's own date for the same reason the
    operations are: money that left after the statement is not inside the value it is compared to.
  */
  const standsOnPayslips = inflows.length === 0 && transferredCents !== 0n;
  const basis = standsOnPayslips
    ? transferred
        .filter((quarter) => quarter.due !== null && (until === null || quarter.due <= until))
        .reduce<Cents>((sum, quarter) => sum + (accruedTotal(quarter) ?? 0n), 0n)
    : paidIn;

  let gainCents: Cents | null = null;
  let gainReason: GainReason | null = null;
  if (value === null) gainReason = "no_value";
  else gainCents = value.cents - basis - transfersIn + withdrawalsCents;
  let gainFraction: number | null = null;
  if (gainCents !== null) {
    if (basis + transfersIn <= 0n) {
      // Nothing is known to have gone in, so the value cannot be split into money put in and money
      // made: the gain is unknown rather than equal to the whole position.
      gainCents = null;
      gainReason = "nothing_paid";
    } else gainFraction = ratio(gainCents, basis + transfersIn);
  }

  // "Still to be credited" is what is genuinely still on its way: a quarter not yet due, or one
  // whose export should have shown a credit and did not. A quarter past its deadline with no
  // export to check it against has left as far as anything here knows (`transferred`), so counting
  // it as pending would keep the whole history waiting for ever (owner, 2026-09-20).
  const pending = quarters
    .filter((quarter) => awaitingCredit(quarter) && quarter.status !== "transferred")
    .map((quarter) => ({
      year: quarter.year,
      quarter: quarter.quarter,
      due: quarter.due,
      cents: accruedTotal(quarter) ?? 0n,
    }))
    .filter((quarter) => quarter.cents !== 0n);

  const credited = quarters.filter(
    (quarter) => !awaitingCredit(quarter) && quarter.operationDates.length > 0,
  );
  const last = credited.at(-1);
  const coveredUntil = last ? monthKey(`${last.year}-${String(last.quarter * 3).padStart(2, "0")}-01`) : null;

  const units =
    input.movements.length === 0 ? null : sumUnits(input.movements.map((movement) => movement.units));
  const priced = input.movements
    .filter((movement) => movement.unitPrice !== null && movement.unitPriceDate !== null)
    .sort((a, b) => (a.unitPriceDate! < b.unitPriceDate! ? -1 : a.unitPriceDate! > b.unitPriceDate! ? 1 : 0));
  const lastPriced = priced.at(-1);

  const fees = (classes: readonly string[]) =>
    total(byClass(classes, input.operations), (operation) => operation.feesCents);
  return {
    value,
    accruedCents: quarters.reduce<Cents>((sum, quarter) => sum + (accruedTotal(quarter) ?? 0n), 0n),
    paidInCents: paidIn,
    enrollmentCents: total(byClass(["enrollment"]), gross),
    voluntaryCents: total(byClass(["voluntary"]), gross),
    transfersInCents: transfersIn,
    withdrawalsCents,
    feesCents: total(input.operations, (operation) => operation.feesCents),
    feesEnrollmentCents: fees(["enrollment"]),
    feesAssociationCents: fees(["contribution", "voluntary"]),
    feesOtherCents: fees(["transfer_in", "switch", "withdrawal", "other"]),
    investedCents: total(input.operations, (operation) => operation.netCents),
    gainCents,
    gainBasisCents: basis,
    standsOnPayslips,
    gainFraction,
    gainReason,
    pendingCents: pending.reduce<Cents>((sum, quarter) => sum + quarter.cents, 0n),
    pending,
    transferredCents,
    coveredUntil,
    units,
    compartments: [...new Set(input.movements.map((movement) => movement.compartment))].sort(),
    lastPrice: lastPriced ? { price: lastPriced.unitPrice!, on: lastPriced.unitPriceDate! } : null,
    laterCents: total(later, gross),
  };
}

export interface BridgeLine {
  key:
    | "accrued"
    | "pending"
    | "enrollment"
    | "voluntary"
    | "other"
    | "paidIn"
    | "fees"
    | "invested"
    | "market"
    | "value";
  cents: Cents;
  total?: boolean;
}

/**
 * "Why the numbers differ?" (GC §12): accrued − not yet credited + enrolment (+ voluntary) = paid
 * in; − explicit fees = invested; + change in value = value. Whatever the payslips and the fund
 * do not explain is its own line ("other"), never hidden in a fee. `null` without a value.
 */
export function bridge(metrics: PensionMetrics): BridgeLine[] | null {
  if (metrics.value === null) return null;
  const explained =
    metrics.accruedCents - metrics.pendingCents + metrics.enrollmentCents + metrics.voluntaryCents;
  // The same paid-in the gain stands on, so the bridge ends where the header says it ends: for a
  // fund fed by payslips alone that is what the transfer schedule has carried, not a zero.
  const other = metrics.gainBasisCents - explained;
  // Only what was credited by the value's date bought units in it.
  const invested = metrics.gainBasisCents - metrics.feesEnrollmentCents - metrics.feesAssociationCents;
  const lines: BridgeLine[] = [
    { key: "accrued", cents: metrics.accruedCents },
    { key: "pending", cents: -metrics.pendingCents },
    { key: "enrollment", cents: metrics.enrollmentCents },
  ];
  if (metrics.voluntaryCents !== 0n) lines.push({ key: "voluntary", cents: metrics.voluntaryCents });
  if (other !== 0n) lines.push({ key: "other", cents: other });
  lines.push(
    { key: "paidIn", cents: metrics.gainBasisCents, total: true },
    { key: "fees", cents: invested - metrics.gainBasisCents },
    { key: "invested", cents: invested, total: true },
    { key: "market", cents: metrics.value.cents - invested },
    { key: "value", cents: metrics.value.cents, total: true },
  );
  return lines;
}

/**
 * Documented points of the value (GC §5): the statements and valuations, and — as a diagnostic
 * recomputation — the units held × the unit price on each price date, when every compartment held
 * has a price that day. No interpolation: between points the chart holds the last one.
 */
export function valuePoints(
  values: readonly { on: CivilDate; cents: Cents }[],
  movements: readonly MovementLike[],
): { on: CivilDate; cents: Cents; kind: "statement" | "units" }[] {
  const points = new Map<CivilDate, { on: CivilDate; cents: Cents; kind: "statement" | "units" }>();
  const dates = [
    ...new Set(movements.flatMap((movement) => (movement.unitPriceDate ? [movement.unitPriceDate] : []))),
  ].sort();
  for (const on of dates) {
    const held = new Map<string, bigint>();
    for (const movement of movements) {
      if (movement.unitPriceDate !== null && movement.unitPriceDate <= on) {
        held.set(movement.compartment, (held.get(movement.compartment) ?? 0n) + micro(movement.units));
      }
    }
    let cents = 0n;
    let complete = true;
    for (const [compartment, units] of held) {
      const price = movements.find(
        (movement) =>
          movement.compartment === compartment &&
          movement.unitPriceDate === on &&
          movement.unitPrice !== null,
      )?.unitPrice;
      if (!price) {
        complete = false;
        break;
      }
      // units × price, both in millionths → cents, half up.
      const product = units * micro(price);
      cents += (product + 5_000_000_000n) / 10_000_000_000n;
    }
    if (complete && held.size > 0) points.set(on, { on, cents, kind: "units" });
  }
  // A statement or a valuation of the same day wins over the recomputation.
  for (const value of values) points.set(value.on, { on: value.on, cents: value.cents, kind: "statement" });
  return [...points.values()].sort((a, b) => (a.on < b.on ? -1 : 1));
}

/** The last documented value at each month's end, held — `null` before the first. */
export function heldAt(
  points: readonly { on: CivilDate; cents: Cents }[],
  months: readonly MonthKey[],
): (Cents | null)[] {
  return months.map((month) => {
    const end = lastDayOfMonth(month);
    const last = points.filter((point) => point.on <= end).at(-1);
    return last ? last.cents : null;
  });
}

/** What had been paid in by each month's end (gross inflows, by operation date). */
/**
 * Every payment into the fund, with the day it landed: its own operations when it has any, and
 * otherwise what the transfer schedule has carried, each quarter at its own deadline — the same
 * figure the "Paid in" tile shows (owner, 2026-09-20). One source or the other, never both: a
 * quarter that has an operation is that operation.
 */
export function paidInFlows(
  operations: readonly OperationLike[],
  quarters: readonly QuarterStatus[] = [],
): { on: CivilDate; chargedCents: Cents }[] {
  const inflows = operations.filter((operation) =>
    ["contribution", "enrollment", "voluntary", "transfer_in"].includes(operation.classification),
  );
  if (inflows.length > 0) {
    return inflows.map((operation) => ({ on: operation.operationDate, chargedCents: gross(operation) }));
  }
  return quarters
    .filter((quarter) => quarter.status === "transferred" && quarter.due !== null)
    .map((quarter) => ({ on: quarter.due!, chargedCents: accruedTotal(quarter) ?? 0n }));
}

/** What had gone in by the end of each month: the "paid in" line of the chart. */
export function paidInAt(
  operations: readonly OperationLike[],
  months: readonly MonthKey[],
  quarters: readonly QuarterStatus[] = [],
): Cents[] {
  const flows = paidInFlows(operations, quarters);
  return months.map((month) => {
    const end = lastDayOfMonth(month);
    return flows.filter((flow) => flow.on <= end).reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
  });
}
