import "server-only";
import { listBalanceEntries } from "@/modules/accounts/queries";
import { getAccount } from "@/modules/accounts/queries";
import { type Document, listDocuments } from "@/modules/imports/service";
import { FUND_ROLES } from "@/modules/payroll/pension";
import { listCodeMap, payslipsOf } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import {
  civilDateIn,
  type CivilDate,
  lastDayOfMonth,
  type MonthKey,
  monthKey,
  monthsBetween,
  today,
} from "@/platform/dates";
import type { Cents } from "@/platform/money";
import type { ValuationRow } from "../queries";
import {
  annualisedOverPeriods,
  fundForecast,
  type FundForecast,
  type PeriodReturn,
  periodReturns,
  periodStats,
} from "../rules";
import type { Fund } from "../service";
import {
  type Operation,
  operationsOf,
  type PositionSnapshot,
  recordedValuationsOf,
  snapshotsOf,
  type UnitMovement,
} from "./imports";
import {
  bridge,
  type BridgeLine,
  type DatedValue,
  heldAt,
  type MovementLike,
  operationUnits,
  paidInAt,
  paidInFlows,
  type PensionMetrics,
  pensionMetrics,
  valuePoints,
} from "./metrics";
import { type OperationLike, type QuarterStatus, reconcile } from "./reconcile";
import {
  type Component,
  DEDUCTIBILITY_LIMITS,
  deductibilityLimit,
  parseSchedule,
  type Quarter,
} from "./rules";
import {
  type Competence,
  competencesOf,
  decisionsOf,
  feeTariffs,
  type PensionRule,
  pensionRulesOf,
  requirePensionFund,
  type ReconciliationLink,
} from "./service";

/** One month of the "Accrued in payslips" table (design), with the state of its quarter. */
export interface MonthRow {
  competence: Competence;
  quarter: QuarterStatus | null;
}

/** A year against its deductibility limit (GC §7): worker + employer, TFR excluded. */
export interface TaxYear {
  year: number;
  workerCents: Cents;
  employerCents: Cents;
  totalCents: Cents;
  limitCents: Cents | null;
}

/**
 * Which payslip codes feed each fund component, by the role the person's own code map gives them
 * (design Settings "Source: payslips"): read-only here — the map itself lives in Settings › Data.
 */
export type FundCodes = Record<string, string[]>;

export interface PensionDetail {
  fund: Fund;
  accountName: string;
  competences: Competence[];
  months: MonthRow[];
  operations: Operation[];
  movements: UnitMovement[];
  /** Units of each operation, as printed (GC §13). */
  unitsOf: Map<string, string>;
  snapshots: PositionSnapshot[];
  quarters: QuarterStatus[];
  metrics: PensionMetrics;
  bridge: BridgeLine[] | null;
  decisions: ReconciliationLink[];
  schedule: PensionRule | null;
  contributionRules: PensionRule[];
  documents: Document[];
  /** When the latest applied export was received: what says whether a missing credit is late. */
  freshness: CivilDate | null;
  tariffs: Awaited<ReturnType<typeof feeTariffs>>;
  taxYears: TaxYear[];
  chart: { months: MonthKey[]; value: (Cents | null)[]; paidIn: Cents[] };
  /**
   * How the fund did, month by month (spec §7.7's Simple Dietz), and where it is heading. The
   * same two the PAC page has shown since F3: a pension fund is measured the same way, once the
   * money that went in is known — which, with no document of the fund's own, is what the transfer
   * schedule carried (owner, 2026-09-20).
   */
  /** The valuations recorded by hand: this fund's value points when nothing is imported. */
  valuations: ValuationRow[];
  periods: PeriodReturn[];
  stats: ReturnType<typeof periodStats>;
  forecast: FundForecast;
  /** Whether the fund's statement is older than its latest operation (GC §11.8). */
  valueOlderThanOperations: boolean;
  /** The codes behind worker, employer, TFR and enrolment, for Settings to show them. */
  codes: FundCodes;
  /** The payslip a competence came from → the document its review page is served from. */
  payslipDocuments: Map<string, string>;
}

const asOperation = (operation: Operation, units: string): OperationLike => ({
  id: operation.id,
  classification: operation.classification,
  competenceYear: operation.competenceYear,
  competenceQuarter: operation.competenceQuarter,
  operationDate: operation.operationDate,
  workerCents: operation.workerCents,
  employerCents: operation.employerCents,
  tfrCents: operation.tfrCents,
  otherCents: operation.otherCents,
  feesCents: operation.feesCents,
  netCents: operation.netCents,
  units,
});

/** Everything the pension pages show, read once (spec §7.7, design "Fund detail"). */
export async function pensionDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  now: Date = new Date(),
): Promise<PensionDetail> {
  const fund = await requirePensionFund(ctx, fundId);
  const todayOn = today(ctx.timeZone, now);
  const [
    account,
    competences,
    { operations, movements },
    snapshots,
    decisions,
    rules,
    documents,
    tariffs,
    entries,
    codeMap,
    payslips,
  ] = await Promise.all([
    getAccount(ctx, fund.valuationAccountId),
    competencesOf(ctx, fund.id),
    operationsOf(ctx, fund.id),
    snapshotsOf(ctx, fund.id),
    decisionsOf(ctx, fund.id),
    pensionRulesOf(ctx, fund.id),
    listDocuments(ctx, ["cometa_operations", "cometa_position"]),
    feeTariffs(fund.provider?.toLowerCase() ?? "cometa"),
    listBalanceEntries(ctx, fund.valuationAccountId, 200),
    listCodeMap(ctx),
    payslipsOf(ctx),
  ]);

  // Both come from payroll's own service functions: this module never reads its tables.
  const codes: FundCodes = {};
  for (const entry of codeMap) {
    if (!FUND_ROLES.includes(entry.role)) continue;
    codes[entry.role] = [...(codes[entry.role] ?? []), entry.code];
  }
  const payslipDocuments = new Map(payslips.map((payslip) => [payslip.id, payslip.documentId]));

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

  const schedule = rules.find((rule) => rule.kind === "payment_schedule") ?? null;
  const freshness =
    documents
      .filter((document) => document.kind === "cometa_operations" && document.state === "applied")
      .map((document) => civilDateIn(document.receivedAt, ctx.timeZone))
      .sort()
      .at(-1) ?? null;

  const quarters = reconcile({
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
    schedule: schedule ? parseSchedule(schedule.schedule) : [],
    toleranceDays: schedule?.toleranceDays ?? 15,
    freshness,
    today: todayOn,
  });

  const latest = entries[0] ?? null;
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
  const metrics = pensionMetrics({ value, operations: asOperations, movements: movementLikes, quarters });

  const byQuarter = new Map(quarters.map((quarter) => [`${quarter.year}-${quarter.quarter}`, quarter]));
  const months: MonthRow[] = competences.map((competence) => ({
    competence,
    quarter: byQuarter.get(`${competence.year}-${competence.quarter}`) ?? null,
  }));

  const taxByYear = new Map<number, TaxYear>();
  for (const operation of operations) {
    if (operation.classification !== "contribution" && operation.classification !== "voluntary") continue;
    const year = Number(operation.operationDate.slice(0, 4));
    const row = taxByYear.get(year) ?? {
      year,
      workerCents: 0n,
      employerCents: 0n,
      totalCents: 0n,
      limitCents: deductibilityLimit(year),
    };
    row.workerCents += operation.workerCents;
    row.employerCents += operation.employerCents;
    row.totalCents = row.workerCents + row.employerCents;
    taxByYear.set(year, row);
  }

  // Simple Dietz over the last twelve months: thirteen month ends, the first being the end of the
  // month before the window, and the money that went in during each month.
  const inflows = paidInFlows(asOperations, quarters).map((flow) => ({ ...flow, feeCents: null }));
  const points = valuePoints(
    entries.map((entry) => ({ on: entry.on, cents: entry.balanceCents })),
    movementLikes,
  );
  const first =
    [
      ...operations.map((operation) => operation.operationDate),
      ...competences.flatMap((one) => (one.payrollPeriod ? [one.payrollPeriod] : [])),
      fund.startOn,
    ].sort()[0] ?? fund.startOn;
  const chartMonths = monthsBetween(monthKey(first), monthKey(todayOn));
  const lastOperation = operations.at(-1)?.operationDate ?? null;
  const returnMonths = chartMonths.slice(-12);
  // What the fund did between one documented value and the next: `points` are exactly those, and
  // nothing is measured across a stretch nobody valued (owner, 2026-09-20).
  const periods = periodReturns(points, inflows);

  return {
    fund,
    accountName: account?.name ?? "",
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
    schedule,
    contributionRules: rules.filter((rule) => rule.kind === "contribution"),
    documents,
    freshness,
    tariffs,
    taxYears: [...taxByYear.values()].sort((a, b) => b.year - a.year),
    chart: {
      months: chartMonths,
      value: heldAt(points, chartMonths),
      paidIn: paidInAt(asOperations, chartMonths, quarters),
    },
    valuations: await recordedValuationsOf(ctx, fund.id, entries, (on) =>
      inflows.filter((flow) => flow.on <= on).reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n),
    ),
    periods,
    stats: periodStats(periods),
    forecast: fundForecast({
      valueCents: value?.cents ?? null,
      paidInCents: metrics.standsOnPayslips ? metrics.transferredCents : metrics.paidInCents,
      flows: inflows,
      months: returnMonths,
      ownRate: annualisedOverPeriods(periods),
    }),
    valueOlderThanOperations: value !== null && lastOperation !== null && lastOperation > value.on,
    codes,
    payslipDocuments,
  };
}

/** The pension columns of the Funds list (design): worker, employer and TFR credited so far. */
export interface PensionSummary {
  fundId: string;
  workerCents: Cents;
  employerCents: Cents;
  tfrCents: Cents;
  paidInCents: Cents;
  pendingCents: Cents;
  valueOn: CivilDate | null;
}

export { DEDUCTIBILITY_LIMITS, lastDayOfMonth };
export type { Quarter };
