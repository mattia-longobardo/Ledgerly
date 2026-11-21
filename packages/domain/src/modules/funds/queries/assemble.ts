// Funds · a fund's detail put together from its rows: pure, once the rows are read.
import { type CivilDate, civilDateIn, type MonthKey, monthKey, monthsBetween } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { listBalanceEntries } from "../../accounts";
import { NO_PERIOD_FEES, type PeriodFees, periodFees } from "../fees";
import {
  bridge,
  currentCompartment,
  type DatedValue,
  type MovementLike,
  operationUnits,
  paidInFlows,
  pensionMetrics,
  valuePoints,
} from "../pension/metrics";
import {
  type Operation,
  type PositionSnapshot,
  recordedValuations,
  type UnitMovement,
} from "../pension/operations";
import { reconcile } from "../pension/reconcile";
import { type Component, DEFAULT_TOLERANCE_DAYS } from "../pension/rules";
import { type Competence, competenceFor, type ReconciliationLink } from "../pension/service";
import { documentedEntries, fundFlows, latestDocumented, projectionMonthly } from "../period";
import { annualisedOverPeriods, fundForecast, periodReturns } from "../rules";
import { contributionsBySource, type Fund, type FundFee, type FundSource } from "../service";
import { competencePeriod, debitStatus, monthlyOf } from "../sources";
import {
  asOperation,
  calendarOf,
  debitPlanOf,
  type DebitRow,
  type FundCodes,
  type FundDetail,
  type MonthRow,
  type PayrollPlan,
  payrollSourceOf,
  type ValuationRecord,
} from "./detail";

export function assemble(input: {
  fund: Fund;
  todayOn: CivilDate;
  timeZone: string;
  account: { name: string; currency: string; color: string | null } | null;
  accountNames: ReadonlyMap<string, string>;
  sources: FundSource[];
  fees: FundFee[];
  allCompetences: Competence[];
  operations: Operation[];
  movements: UnitMovement[];
  snapshots: PositionSnapshot[];
  decisions: ReconciliationLink[];
  valuationRows: readonly ValuationRecord[];
  entries: Awaited<ReturnType<typeof listBalanceEntries>>;
  codes: FundCodes;
  payslipDocuments: Map<string, string>;
}): FundDetail {
  const { fund, todayOn, sources, fees, operations, movements, snapshots, decisions, entries } = input;

  const payrollSource = payrollSourceOf(sources);
  const payroll: PayrollPlan | null =
    payrollSource === null
      ? null
      : {
          source: payrollSource,
          period: payrollSource.accrualPeriod ?? "quarter",
          calendar: calendarOf(payrollSource),
          toleranceDays: payrollSource.toleranceDays ?? DEFAULT_TOLERANCE_DAYS,
        };
  // A fund reads the components its payslip sources take: the others are `null`, as on a payslip
  // that has no such line. A fund with no payslip source reads no payslip.
  const components = [
    ...new Set(sources.flatMap((source) => (source.kind === "payroll" ? (source.components ?? []) : []))),
  ];
  const competences =
    payroll === null ? [] : input.allCompetences.map((row) => competenceFor(row, components));

  const byOperation = new Map<string, UnitMovement[]>();
  for (const movement of movements) {
    byOperation.set(movement.operationId, [...(byOperation.get(movement.operationId) ?? []), movement]);
  }
  const unitsOf = new Map(
    operations.map((operation) => [operation.id, operationUnits(byOperation.get(operation.id) ?? [])]),
  );
  const asOperations = operations.map((operation) =>
    asOperation(operation, unitsOf.get(operation.id) ?? "0"),
  );

  const estimate: PeriodFees =
    payroll === null
      ? NO_PERIOD_FEES
      : periodFees(fees, { sourceId: payroll.source.id, period: payroll.period, on: todayOn });
  // The register is as fresh as its last line written by a person or read from a document. What the
  // job writes from the bank says nothing about the transfers of the payslip.
  const freshness =
    operations
      .filter((operation) => operation.source !== "rule")
      .map((operation) => civilDateIn(operation.createdAt, input.timeZone))
      .sort()
      .at(-1) ?? null;

  const quarters =
    payroll === null
      ? []
      : reconcile({
          competences,
          operations: asOperations,
          decisions: decisions.map((row) => ({
            year: row.year,
            quarter: row.quarter,
            component: row.component as Component,
            decision: row.decision,
            differenceCents: row.differenceCents,
            note: row.note,
          })),
          period: payroll.period,
          calendar: payroll.calendar,
          toleranceDays: payroll.toleranceDays,
          freshness,
          today: todayOn,
        });

  // The snapshot's copies stay for Overview and Accounts: here they would date the value a month
  // later than anybody read it, and hide a real valuation of the same day (funds-ux §5.2).
  const latest = latestDocumented(entries);
  const value: DatedValue | null = latest
    ? {
        cents: latest.balanceCents,
        on: latest.on,
        source: latest.source === "import" ? "statement" : "manual",
      }
    : null;
  const movementLikes: MovementLike[] = movements.map((movement) => ({
    operationId: movement.operationId,
    compartment: movement.compartment,
    units: movement.units,
    unitPrice: movement.unitPrice,
    unitPriceDate: movement.unitPriceDate,
  }));
  const metrics = pensionMetrics({
    value,
    operations: asOperations,
    movements: movementLikes,
    quarters,
    fees: estimate,
  });

  const byQuarter = new Map(quarters.map((quarter) => [`${quarter.year}-${quarter.quarter}`, quarter]));
  const months: MonthRow[] = competences.map((competence) => ({
    competence,
    quarter:
      byQuarter.get(`${competence.year}-${competencePeriod(competence, payroll?.period ?? "quarter")}`) ??
      null,
  }));

  const inflows = paidInFlows(asOperations, quarters, estimate).map((flow) => ({ ...flow, feeCents: null }));
  const points = valuePoints(
    documentedEntries(entries).map((entry) => ({ on: entry.on, cents: entry.balanceCents })),
    movementLikes,
  );
  const first =
    [
      ...operations.map((operation) => operation.operationDate),
      ...competences.flatMap((one) => (one.payrollPeriod ? [one.payrollPeriod] : [])),
      fund.startOn,
    ].sort()[0] ?? fund.startOn;
  const returnMonths: MonthKey[] = monthsBetween(monthKey(first), monthKey(todayOn)).slice(-12);
  const lastOperation = operations.at(-1)?.operationDate ?? null;
  const flows = fundFlows(asOperations, quarters, estimate);

  const voluntaryDays = operations
    .filter((operation) => operation.classification === "voluntary")
    .map((operation) => operation.operationDate);
  const debits: DebitRow[] = sources
    .filter((source) => source.kind === "bank_debit")
    .map((source) => {
      const plan = debitPlanOf(source, fund);
      return {
        source,
        plan,
        status: debitStatus({
          plan,
          active: fund.state === "active" && source.state === "active",
          expectsAmount: source.amountCents !== null,
          contributions: voluntaryDays,
          todayOn,
        }),
        accountName: source.accountId === null ? null : (input.accountNames.get(source.accountId) ?? null),
      };
    });
  const planned = debits
    .filter((debit) => fund.state === "active" && debit.source.state === "active")
    .reduce<Cents>((sum, debit) => sum + monthlyOf(debit.source.amountCents ?? 0n, debit.plan.frequency), 0n);
  // What the projection starts from. A fund fed by the payslip starts from the money its header
  // measures the gain against, as it always has; any other fund from everything it was paid.
  const everPaid = flows
    .filter((flow) => flow.chargedCents > 0n)
    .reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
  const paidInCents =
    payroll === null ? everPaid : metrics.standsOnPayslips ? metrics.transferredCents : metrics.paidInCents;

  return {
    fund,
    accountName: input.account?.name ?? "",
    currency: input.account?.currency ?? "EUR",
    color: input.account?.color ?? null,
    sources,
    sourceContributions: contributionsBySource(sources, operations),
    fees,
    payroll,
    debits,
    competences,
    months,
    operations,
    movements,
    unitsOf,
    snapshots,
    quarters,
    metrics,
    bridge: bridge(metrics),
    decisions,
    freshness,
    points: points.map(({ on, cents }) => ({ on, cents })),
    valuations: recordedValuations(input.valuationRows, entries, (on) =>
      inflows.filter((flow) => flow.on <= on).reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n),
    ),
    forecast: fundForecast({
      valueCents: value?.cents ?? null,
      paidInCents,
      monthlyCents: projectionMonthly({
        planCents: planned > 0n ? planned : null,
        flows,
        months: returnMonths,
      }),
      ownRate: annualisedOverPeriods(periodReturns(points, inflows)),
    }),
    valueOlderThanOperations: value !== null && lastOperation !== null && lastOperation > value.on,
    compartment: currentCompartment(movementLikes, fund.compartment),
    codes: input.codes,
    payslipDocuments: input.payslipDocuments,
  };
}

/**
 * A fund's money, as the period engine reads it (funds-ux §5.2).
 *
 * The flows keep the order each register was read in before the single model: oldest first for a
 * fund fed by the payslip, newest first for any other fund. No figure depends on the order by its
 * meaning — but a return is a sum of floats (Modified Dietz, XIRR), and a sum of floats is the same
 * to its last digit only when it adds in the same order. The numbers of release N6 are held to the
 * ones of before byte for byte (tests SN1 and SN3), so the order stays.
 */
