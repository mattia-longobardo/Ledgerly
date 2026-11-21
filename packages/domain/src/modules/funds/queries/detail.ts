// Funds · a fund's detail: the one read of everything a fund's page and its row in the home show.
import { and, eq } from "drizzle-orm";
import type { Ctx } from "../../../platform/context";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import { type CivilDate, today } from "../../../shared/dates";
import { listAccounts, listBalanceEntries } from "../../accounts";
import { type BridgeLine, type PensionMetrics } from "../pension/metrics";
import {
  type Operation,
  operationsOf,
  type PositionSnapshot,
  recordedValuations,
  snapshotsOf,
  type UnitMovement,
  type ValuationRow,
  valuationsOf,
} from "../pension/operations";
import { FUND_ROLES } from "../pension/payroll-source";
import { type OperationLike, type QuarterStatus } from "../pension/reconcile";
import { type Competence, competencesOf, decisionsOf, type ReconciliationLink } from "../pension/service";
import { type ValuePoint } from "../period";
import { payslipDirectory } from "../ports";
import { type FundForecast } from "../rules";
import { funds } from "../schema";
import { feesOf, type Fund, FundError, type FundFee, type FundSource, sourcesOf } from "../service";
import {
  type AccrualPeriod,
  type DebitPlan,
  type DebitStatus,
  type DueCalendar,
  NO_CALENDAR,
  parseDueEntries,
} from "../sources";
import { assemble } from "./assemble";

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

export const asOperation = (operation: Operation, units: string): OperationLike => ({
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

export type ValuationRecord = Parameters<typeof recordedValuations>[0][number];

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
  /**
   * `history: false` leaves out what only a fund's own page shows — the valuations with their notes
   * and the positions a statement stated: the home reads neither, and no number depends on them.
   */
  options: { history?: boolean } = {},
): Promise<FundDetail[]> {
  if (list.length === 0) return [];
  const todayOn = today(ctx.timeZone, now);
  const ids = list.map((fund) => fund.id);
  const history = options.history ?? true;
  const [accounts, sources, fees, registers, snapshotsOfFund, valuationRows] = await Promise.all([
    listAccounts(ctx, { includeArchived: true }),
    sourcesOf(ctx, ids),
    feesOf(ctx, ids),
    operationsOf(ctx, ids),
    history ? snapshotsOf(ctx, ids) : new Map<string, PositionSnapshot[]>(),
    history ? valuationsOf(ctx, ids) : new Map<string, ValuationRecord[]>(),
  ]);
  // The payslip side is read only for the funds that have a payslip source.
  const fed = [
    ...new Set(sources.filter((source) => source.kind === "payroll").map((source) => source.fundId)),
  ];
  const [competencesOfFund, decisionsOfFund] = await Promise.all([
    competencesOf(ctx, fed),
    decisionsOf(ctx, fed),
  ]);
  const accountOf = new Map(accounts.map((account) => [account.id, account]));

  // Both come through the port `PayslipDirectory`: this module never reads payroll. Funds
  // with no payslip source ask payroll nothing.
  const codes: FundCodes = {};
  let payslipDocuments = new Map<string, string>();
  if (fed.length > 0) {
    const [codeMap, documents] = await Promise.all([
      payslipDirectory().codeRoles(ctx),
      payslipDirectory().payslipDocuments(ctx),
    ]);
    for (const entry of codeMap) {
      if (!FUND_ROLES.includes(entry.role)) continue;
      codes[entry.role] = [...(codes[entry.role] ?? []), entry.code];
    }
    payslipDocuments = documents;
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
