// The figures the Funds pages derive from a fund's rows (rewrite plan R3, PERS-537): pure, and on top of
// the engine of the period, so a page and `/api/v1` read one computation instead of each its own.
import { type CivilDate } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { contributionFee, periodFees, assetsCost } from "../fees";
import { feeValidOn } from "../../../shared/fees";
import type { FundLine, HomeFund } from "../home";
import type { Operation } from "../pension/operations";
import { type FundPeriod, onTheWay } from "../period";
import type { FundDetail } from "./detail";
import { hasPayrollCalendar } from "./lists";
import { competencePeriod, periodStart, periodsPerYear, type SourceKind } from "../sources";
import { competenceOn, inPeriod } from "../tabs";

/** Where a line of the register came from, as its badge says it. */
export type OperationOrigin = "payroll" | "rule" | "manual" | "import";

const ORIGIN_OF_KIND: Record<SourceKind, OperationOrigin> = {
  payroll: "payroll",
  bank_debit: "rule",
  manual: "manual",
};

/**
 * The origin of an operation: the kind of the source it belongs to, when it has one — a payslip
 * contribution written by hand belongs to the payslip source —, otherwise who wrote it.
 */
export function operationOrigin(
  operation: { source: OperationOrigin | string; sourceId: string | null },
  sources: readonly { id: string; kind: SourceKind }[],
): OperationOrigin {
  const source = operation.sourceId === null ? null : sources.find((one) => one.id === operation.sourceId);
  if (source) return ORIGIN_OF_KIND[source.kind];
  return operation.source === "import" ? "import" : operation.source === "rule" ? "rule" : "manual";
}

interface Amounts {
  classification: string;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  otherCents: Cents;
}

/** What an operation moved across the fund's boundary, gross: an exit is money out, so it is negative. */
export function operationGross(operation: Amounts): Cents {
  const gross = operation.workerCents + operation.employerCents + operation.tfrCents + operation.otherCents;
  return operation.classification === "withdrawal" && gross > 0n ? -gross : gross;
}

/** What the voluntary contributions of some operations add up to: the part of "you" paid outside the payslip. */
export function voluntaryCents(operations: readonly Amounts[]): Cents {
  return operations
    .filter((operation) => operation.classification === "voluntary")
    .reduce<Cents>((sum, operation) => sum + operation.workerCents, 0n);
}

/** The operations of a fund in a period, in the register's order. */
export const operationsIn = (detail: Pick<FundDetail, "operations">, period: FundPeriod): Operation[] =>
  detail.operations.filter((operation) => inPeriod(operation.operationDate, period));

/** The voluntary payments of some funds in a period: the part of "you" the KPI and «Who paid in» take apart. */
export function voluntaryIn(
  lines: readonly Pick<FundLine, "fund">[],
  detailOf: ReadonlyMap<string, Pick<FundDetail, "operations">>,
  period: FundPeriod,
): Cents {
  return lines.reduce<Cents>((sum, line) => {
    const detail = detailOf.get(line.fund.id);
    return detail === undefined ? sum : sum + voluntaryCents(operationsIn(detail, period));
  }, 0n);
}

/** The first day money went in, across some funds; `null` when none ever did. */
export const firstPaidOn = (funds: readonly Pick<HomeFund, "flows">[]): CivilDate | null =>
  funds
    .flatMap((fund) => fund.flows.filter((flow) => flow.chargedCents > 0n).map((flow) => flow.on))
    .sort()[0] ?? null;

/** The first documented value, across some funds; `null` when none was ever read. */
export const firstValueOn = (funds: readonly Pick<HomeFund, "points">[]): CivilDate | null =>
  funds.flatMap((fund) => fund.points.map((point) => point.on)).sort()[0] ?? null;

/** A fund's newest documented value, whatever its date. */
export const newestPoint = (fund: Pick<HomeFund, "points">): { on: CivilDate; cents: Cents } | null =>
  [...fund.points].sort((left, right) => (left.on < right.on ? 1 : -1))[0] ?? null;

/**
 * The note under the «Accrued» KPI: the first fund of the period with money accrued, and the latest
 * day its accrued months of the span are due. `null` when no fund accrued anything.
 */
export function accruedNote(
  lines: readonly FundLine[],
  span: { from: CivilDate; to: CivilDate },
): { fundId: string; dueOn: CivilDate | null } | null {
  const fund = lines.find((line) => line.accruedCents !== 0n)?.fund;
  if (fund === undefined) return null;
  const dueOn = fund.accrued
    .filter((line) => line.on >= span.from && line.on <= span.to)
    .map((line) => line.dueOn)
    .filter((due) => due !== null)
    .sort()
    .at(-1);
  return { fundId: fund.id, dueOn: dueOn ?? null };
}

/** The Overview's «Recent»: the last five operations of the period that moved money, newest first. */
export const recentOperations = (operations: readonly Operation[], count = 5): Operation[] =>
  operations
    .filter((operation) => operationGross(operation) !== 0n)
    .reverse()
    .slice(0, count);

const add = <T>(rows: readonly T[], pick: (row: T) => Cents | null) =>
  rows.reduce<Cents>((sum, row) => sum + (pick(row) ?? 0n), 0n);

/**
 * The total row of the register: the payslip's components without the voluntary payments, which
 * have their own column; «other» with an exit's sign; the fees as a positive cost.
 */
export function registerTotals(rows: readonly Operation[]) {
  const voluntary = (one: Operation) => one.classification === "voluntary";
  const part = (one: Operation, cents: Cents) => (voluntary(one) ? null : cents);
  return {
    workerCents: add(rows, (one) => part(one, one.workerCents)),
    employerCents: add(rows, (one) => part(one, one.employerCents)),
    tfrCents: add(rows, (one) => part(one, one.tfrCents)),
    voluntaryCents: add(rows, (one) => (voluntary(one) ? one.workerCents : null)),
    otherCents: add(rows, (one) => (one.classification === "withdrawal" ? -one.otherCents : one.otherCents)),
    feesCents: add(rows, (one) => one.feesCents),
    netCents: add(rows, (one) => one.netCents),
  };
}

/** The payslips of the period, one per month a competence counts on, with the period they belong to. */
export function payslipLines(detail: Pick<FundDetail, "months" | "payroll">, period: FundPeriod) {
  const accrual = detail.payroll?.period ?? "quarter";
  const lines = detail.months
    .filter(({ competence }) => inPeriod(competenceOn(competence), period))
    .map(({ competence, quarter }) => ({
      competence,
      quarter,
      index: competencePeriod(competence, accrual),
      totalCents:
        (competence.workerCents ?? 0n) + (competence.employerCents ?? 0n) + (competence.tfrCents ?? 0n),
    }));
  return {
    lines,
    totals: {
      workerCents: add(lines, (line) => line.competence.workerCents),
      employerCents: add(lines, (line) => line.competence.employerCents),
      tfrCents: add(lines, (line) => line.competence.tfrCents),
      totalCents: add(lines, (line) => line.totalCents),
    },
  };
}

/** More than any contribution: the fees "on each contribution" are read as amounts, whatever is charged. */
const ANY_AMOUNT: Cents = 1_000_000_000_000n;

type SetupDetail = Pick<FundDetail, "fund" | "payroll" | "sources" | "fees" | "competences" | "quarters">;

/** The fee each kind of contribution starts with: what the fund's list of fees says today. */
function defaultFees({ payroll, sources, fees }: SetupDetail, todayOn: CivilDate) {
  const amounts = fees.filter((fee) => fee.rate === null);
  // A voluntary payment written by hand costs what the recurring debit costs, as it always has.
  const debit = sources.find((source) => source.kind === "bank_debit" && source.state === "active");
  const byHand = debit ?? sources.find((source) => source.kind === "manual") ?? null;
  const feeOf = (sourceId: string | null) =>
    contributionFee(amounts, { on: todayOn, chargedCents: ANY_AMOUNT, sourceId }) ?? 0n;
  return {
    voluntaryFeeCents: feeOf(byHand?.id ?? null),
    payrollFeeCents:
      payroll === null
        ? 0n
        : feeOf(payroll.source.id) +
          periodFees(fees, { sourceId: payroll.source.id, period: payroll.period, on: todayOn }).quarterCents,
  };
}

/** The periods a payslip contribution can be for, newest first: none without a payslip source. */
function periodChoices({ fund, payroll, competences }: SetupDetail, todayOn: CivilDate) {
  const periods: { year: number; index: number }[] = [];
  if (payroll === null) return periods;
  const firstYear = Math.min(Number(fund.startOn.slice(0, 4)), ...competences.map((one) => one.year));
  for (let year = Number(todayOn.slice(0, 4)); year >= firstYear; year -= 1) {
    for (let index = periodsPerYear(payroll.period); index >= 1; index -= 1) {
      if (periodStart(year, index, payroll.period) <= todayOn) periods.push({ year, index });
    }
  }
  return periods;
}

/**
 * What «Record contribution» opens with (§8.1): the kind, the fee the fund's list of fees says for
 * each kind, the periods a payslip contribution can be for (newest first), and the oldest period
 * still on its way.
 */
export function contributionDefaults(detail: SetupDetail, todayOn: CivilDate) {
  const { payroll, sources } = detail;
  const pending = hasPayrollCalendar(detail)
    ? [...onTheWay(detail.quarters).quarters].sort(
        (left, right) => left.year - right.year || left.quarter - right.quarter,
      )[0]
    : undefined;
  const byPayslipOnly =
    payroll !== null && !sources.some((source) => source.kind === "bank_debit" || source.kind === "manual");
  return {
    kind: byPayslipOnly ? ("payroll" as const) : ("voluntary" as const),
    ...defaultFees(detail, todayOn),
    periods: periodChoices(detail, todayOn),
    pending: pending === undefined ? null : { year: pending.year, index: pending.quarter },
  };
}

/**
 * What the fees on the assets cost in a year, estimated on the fund's last value (Settings, fees):
 * `none` with no such fee in force today, `needs_value` with no value to estimate on.
 */
export function assetsEstimate(detail: Pick<FundDetail, "fees" | "metrics">, todayOn: CivilDate) {
  const value = detail.metrics.value;
  const onAssets = detail.fees.some(
    (fee) => fee.basis === "on_assets" && fee.rate !== null && feeValidOn(fee, todayOn),
  );
  const cost = value === null ? null : assetsCost(detail.fees, value.cents, todayOn);
  if (!onAssets) return { state: "none" as const, cost: null, value: null };
  if (value === null || cost === null) return { state: "needs_value" as const, cost: null, value: null };
  return { state: "estimated" as const, cost, value };
}

/**
 * What the gain chart reads off its bars (funds-ux §6): the running total from zero, the best and the
 * worst bar, and the factor that turns money into the share of the period's return (Modified Dietz:
 * an interval's gain over the period's capital, so the bars add up to the rate). A gap stays a gap;
 * `scale` is `null` when the period has no rate or no gain to read the capital from.
 */
export function gainChart(totals: readonly (Cents | null)[], totalCents: Cents | null, rate: number | null) {
  let running: Cents = 0n;
  const cumulative = totals.map((cents) => (cents === null ? null : (running += cents)));
  let best = -1;
  let worst = -1;
  totals.forEach((cents, index) => {
    if (cents === null) return;
    if (best < 0 || cents > totals[best]!) best = index;
    if (worst < 0 || cents < totals[worst]!) worst = index;
  });
  const scale =
    totalCents === null || rate === null || totalCents === 0n || rate === 0
      ? null
      : rate / Number(totalCents);
  return { cumulative, best: best < 0 ? null : best, worst: worst < 0 ? null : worst, scale };
}
