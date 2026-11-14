import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { listAccounts, listBalanceEntries } from "@/modules/accounts/queries";
import { FUND_ROLES } from "@/modules/payroll/pension";
import { listCodeMap, payslipsOf } from "@/modules/payroll/service";
import type { Ctx } from "@/platform/context";
import { civilDateIn, type CivilDate, type MonthKey, monthKey, monthsBetween, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import { type PeriodFees, periodFees, NO_PERIOD_FEES } from "./fees";
import {
  documentedEntries,
  type FundFlow,
  fundFlows,
  latestDocumented,
  projectionMonthly,
  type ValuePoint,
} from "./period";
import {
  bridge,
  type BridgeLine,
  currentCompartment,
  type DatedValue,
  type MovementLike,
  operationUnits,
  paidInFlows,
  type PensionMetrics,
  pensionMetrics,
  valuePoints,
} from "./pension/metrics";
import {
  type Operation,
  operationsOf,
  type PositionSnapshot,
  recordedValuations,
  snapshotsOf,
  type UnitMovement,
  type ValuationRow,
  valuationsOf,
} from "./pension/operations";
import { type OperationLike, type QuarterStatus, reconcile } from "./pension/reconcile";
import { type Component, DEFAULT_TOLERANCE_DAYS } from "./pension/rules";
import {
  type Competence,
  competenceFor,
  competencesOf,
  decisionsOf,
  type ReconciliationLink,
} from "./pension/service";
import { annualisedOverPeriods, fundForecast, type FundForecast, periodReturns } from "./rules";
import { funds } from "./schema";
import {
  contributionsBySource,
  feesOf,
  type Fund,
  type FundFee,
  FundError,
  type FundSource,
  sourcesOf,
} from "./service";
import {
  type AccrualPeriod,
  competencePeriod,
  type DebitPlan,
  type DebitStatus,
  debitStatus,
  type DueCalendar,
  hasDueDates,
  monthlyOf,
  NO_CALENDAR,
  parseDueEntries,
} from "./sources";

/** One month of the "Accrued in payslips" table (design), with the state of its period. */
export interface MonthRow {
  competence: Competence;
  quarter: QuarterStatus | null;
}

/**
 * Which payslip codes feed each fund component, by the role the person's own code map gives them
 * (design Settings "Source: payslips"): read-only here — the map itself lives in Settings › Data.
 */
export type FundCodes = Record<string, string[]>;

/** The payslip side of a fund, as its payslip source configures it. */
export interface PayrollPlan {
  source: FundSource;
  period: AccrualPeriod;
  calendar: DueCalendar;
  toleranceDays: number;
}

/** A recurring debit of a fund, with the state of its running period. */
export interface DebitRow {
  source: FundSource;
  plan: DebitPlan;
  status: DebitStatus;
  accountName: string | null;
}

export interface FundDetail {
  fund: Fund;
  accountName: string;
  /** The currency of the account that holds the value: fixed when the fund was created. */
  currency: string;
  /** The colour of that account: the fund's colour in the charts. */
  color: string | null;
  sources: FundSource[];
  /** How many contributions each source has: one with contributions is paused, never removed. */
  sourceContributions: Map<string, number>;
  fees: FundFee[];
  /** The fund's payslip source, the active one when it has several; `null` for a fund with none. */
  payroll: PayrollPlan | null;
  debits: DebitRow[];
  competences: Competence[];
  months: MonthRow[];
  operations: Operation[];
  movements: UnitMovement[];
  /** Units of each operation, as printed (GC §13). */
  unitsOf: Map<string, string>;
  /** The positions a statement stated before release N6: history, read only. */
  snapshots: PositionSnapshot[];
  quarters: QuarterStatus[];
  metrics: PensionMetrics;
  bridge: BridgeLine[] | null;
  decisions: ReconciliationLink[];
  /** The last day the register was written by hand or from a document: what says whether a missing credit is late. */
  freshness: CivilDate | null;
  /** Every documented value, oldest first: the readings of the account, and units × price. */
  points: ValuePoint[];
  /** The valuations recorded by hand. */
  valuations: ValuationRow[];
  forecast: FundForecast;
  /** Whether the fund's value is older than its latest operation (GC §11.8). */
  valueOlderThanOperations: boolean;
  /** The compartment the units are in, which the fund's own field may not say. */
  compartment: string | null;
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
  source: operation.source,
  feesUnknown: operation.feesUnknown,
});

/** The payslip source a fund counts its periods by: the active one, else the oldest. */
export function payrollSourceOf<T extends Pick<FundSource, "kind" | "state">>(
  sources: readonly T[],
): T | null {
  const payroll = sources.filter((source) => source.kind === "payroll");
  return payroll.find((source) => source.state === "active") ?? payroll[0] ?? null;
}

/** The due dates of a payslip source: its rule, or the explicit dates it was given. */
export function calendarOf(source: FundSource): DueCalendar {
  if (source.accrualPeriod === null) return NO_CALENDAR;
  return {
    rule:
      source.dueDay === null || source.dueOffsetMonths === null
        ? null
        : { day: source.dueDay, offsetMonths: source.dueOffsetMonths },
    entries: parseDueEntries(source.dueEntries, source.accrualPeriod),
  };
}

/** The plan of a recurring debit: its frequency, its day and its dates, from the fund's start. */
export function debitPlanOf(source: FundSource, fund: Pick<Fund, "startOn">): DebitPlan {
  return {
    frequency: { count: source.intervalCount ?? 1, unit: source.intervalUnit ?? "month" },
    day: source.debitDay,
    startOn: source.validFrom ?? fund.startOn,
    endOn: source.validTo,
  };
}

/** A fund's values over its whole life: the sum of the years depends on every one of them. */
const ALL_ENTRIES = 100_000;

/** Everything one fund's pages show. */
export async function fundDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  fundId: string,
  now: Date = new Date(),
): Promise<FundDetail> {
  const [fund] = await getDb()
    .select()
    .from(funds)
    .where(and(eq(funds.id, fundId), userScoped(ctx).owns(funds)));
  if (!fund) throw new FundError("not_found");
  return (await fundDetails(ctx, [fund], now))[0];
}

/**
 * Everything the pages show of each fund, in the order given: the same read for every fund, and
 * one query per table for all of them — the home reads as many tables with ten funds as with one.
 */
export async function fundDetails(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  list: readonly Fund[],
  now: Date = new Date(),
): Promise<FundDetail[]> {
  if (list.length === 0) return [];
  const todayOn = today(ctx.timeZone, now);
  const ids = list.map((fund) => fund.id);
  const [
    accounts,
    sources,
    fees,
    competencesOfFund,
    registers,
    snapshotsOfFund,
    decisionsOfFund,
    valuationRows,
  ] = await Promise.all([
    listAccounts(ctx, { includeArchived: true }),
    sourcesOf(ctx, ids),
    feesOf(ctx, ids),
    competencesOf(ctx, ids),
    operationsOf(ctx, ids),
    snapshotsOf(ctx, ids),
    decisionsOf(ctx, ids),
    valuationsOf(ctx, ids),
  ]);
  const accountOf = new Map(accounts.map((account) => [account.id, account]));

  // Both come from payroll's own service functions: this module never reads its tables. Funds
  // with no payslip source ask payroll nothing.
  const codes: FundCodes = {};
  let payslipDocuments = new Map<string, string>();
  if (sources.some((source) => source.kind === "payroll")) {
    const [codeMap, payslips] = await Promise.all([listCodeMap(ctx), payslipsOf(ctx)]);
    for (const entry of codeMap) {
      if (!FUND_ROLES.includes(entry.role)) continue;
      codes[entry.role] = [...(codes[entry.role] ?? []), entry.code];
    }
    payslipDocuments = new Map(payslips.map((payslip) => [payslip.id, payslip.documentId]));
  }

  const details: FundDetail[] = [];
  for (const fund of list) {
    const entries = await listBalanceEntries(ctx, fund.valuationAccountId, ALL_ENTRIES);
    details.push(
      assemble({
        fund,
        todayOn,
        timeZone: ctx.timeZone,
        account: accountOf.get(fund.valuationAccountId) ?? null,
        accountNames: new Map(accounts.map((account) => [account.id, account.name])),
        sources: sources.filter((source) => source.fundId === fund.id),
        fees: fees.filter((fee) => fee.fundId === fund.id),
        allCompetences: competencesOfFund.get(fund.id) ?? [],
        operations: registers.get(fund.id)?.operations ?? [],
        movements: registers.get(fund.id)?.movements ?? [],
        snapshots: snapshotsOfFund.get(fund.id) ?? [],
        decisions: decisionsOfFund.get(fund.id) ?? [],
        valuationRows: valuationRows.get(fund.id) ?? [],
        entries,
        codes,
        payslipDocuments,
      }),
    );
  }
  return details;
}

/** One fund's detail from its rows. Pure: every row was read by the caller. */
function assemble(input: {
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
  valuationRows: Parameters<typeof recordedValuations>[0];
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
export function fundDetailFlows(detail: FundDetail, todayOn: CivilDate): FundFlow[] {
  const { payroll } = detail;
  const operations = detail.operations.map((operation) =>
    asOperation(operation, detail.unitsOf.get(operation.id) ?? "0"),
  );
  return fundFlows(
    payroll === null ? operations.reverse() : operations,
    detail.quarters,
    payroll === null
      ? NO_PERIOD_FEES
      : periodFees(detail.fees, { sourceId: payroll.source.id, period: payroll.period, on: todayOn }),
  );
}

/** Whether "On the way" and the periods' reconciliation have something to say: a payslip source with due dates. */
export const hasPayrollCalendar = (detail: Pick<FundDetail, "payroll">): boolean =>
  detail.payroll !== null && hasDueDates(detail.payroll.calendar);

/**
 * The accounts that are a fund's valuation account: `funds` writes them, so no other module may
 * take them over (docs/design/investments.md §1.3).
 */
export async function valuationAccountIds(ctx: Pick<Ctx, "userId">): Promise<Set<string>> {
  const rows = await getDb()
    .select({ id: funds.valuationAccountId })
    .from(funds)
    .where(userScoped(ctx).owns(funds));
  return new Set(rows.map((row) => row.id));
}

/** Funds by name, for the ⌘K palette (spec §8.2). */
export async function searchFunds(
  ctx: Pick<Ctx, "userId">,
  term: string,
): Promise<{ id: string; name: string }[]> {
  const needle = term.trim().toLocaleLowerCase();
  if (needle === "") return [];
  const rows = await getDb()
    .select({ id: funds.id, name: funds.name })
    .from(funds)
    .where(and(userScoped(ctx).owns(funds), eq(funds.state, "active")))
    .orderBy(asc(funds.name), asc(funds.id));
  return rows.filter((row) => row.name.toLocaleLowerCase().includes(needle)).slice(0, 5);
}
