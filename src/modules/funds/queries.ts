import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  accountsView,
  balancesOn,
  getAccount,
  listAccounts,
  listBalanceEntries,
} from "@/modules/accounts/queries";
import type { Ctx } from "@/platform/context";
import { addDays, addMonths, type CivilDate, type MonthKey, monthKey, today } from "@/platform/dates";
import { getDb } from "@/platform/db/client";
import { userScoped } from "@/platform/db/scope";
import type { Cents } from "@/platform/money";
import {
  annualisedOverPeriods,
  cumulativeAt,
  fundForecast,
  type FundForecast,
  fundMetrics,
  type FundMetrics,
  type PeriodReturn,
  periodReturns,
  periodStats,
} from "./rules";
import { COMETA_SCHEDULE, dueDate, parseSchedule, type Quarter, type ScheduleEntry } from "./pension/rules";
import {
  fundDeposits,
  fundDepositRules,
  fundOperations,
  funds,
  fundValuations,
  pensionCompetences,
  pensionRules,
} from "./schema";
import { type Fund, type FundDeposit, FundError } from "./service";

interface PensionFlow {
  on: CivilDate;
  chargedCents: Cents;
  feeCents: Cents;
}

/**
 * What a pension fund has paid in (GC §9.1): the gross inflows of its operations — contributions,
 * enrolment and voluntary payments —, since a pension fund has no PAC deposits (plan F6 L5).
 *
 * A fund with no operation at all has nothing to put on that line, and an empty row says less than
 * the money the payslips already carry (owner, 2026-09-20): for those funds the accrued of the
 * competences stands in, with no caption of its own — it is the same paid-in as any other. The
 * first imported operation ends the stand-in.
 *
 * The stand-in follows the fund's own transfer schedule, not the payslip months: the employer
 * pays quarterly, so a month accrued in March has not reached the fund until the deadline of its
 * quarter. Each quarter counts once its due date has passed, dated by that date — which is what
 * makes this line agree with the quarters the fund's own page calls `transferred`.
 */
async function pensionInflows(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
  todayOn: CivilDate,
): Promise<Map<string, PensionFlow[]>> {
  if (fundIds.length === 0) return new Map();
  const rows = await getDb()
    .select({
      fundId: fundOperations.fundId,
      on: fundOperations.operationDate,
      fees: fundOperations.feesCents,
      classification: fundOperations.classification,
      worker: fundOperations.workerCents,
      employer: fundOperations.employerCents,
      tfr: fundOperations.tfrCents,
      other: fundOperations.otherCents,
    })
    .from(fundOperations)
    .where(and(userScoped(ctx).owns(fundOperations), inArray(fundOperations.fundId, [...fundIds])))
    .orderBy(asc(fundOperations.operationDate), asc(fundOperations.id));
  const flows = new Map<string, PensionFlow[]>();
  const add = (fundId: string, flow: PensionFlow) => {
    flows.set(fundId, [...(flows.get(fundId) ?? []), flow]);
  };
  for (const row of rows) {
    if (!["contribution", "enrollment", "voluntary"].includes(row.classification)) continue;
    const gross = row.worker + row.employer + row.tfr + row.other;
    add(row.fundId, { on: row.on, chargedCents: gross, feeCents: row.fees });
  }

  const bare = fundIds.filter((id) => !flows.has(id));
  if (bare.length === 0) return flows;
  const schedules = await paymentSchedules(ctx, bare);
  const accrued = await getDb()
    .select({
      fundId: pensionCompetences.fundId,
      period: pensionCompetences.payrollPeriod,
      year: pensionCompetences.year,
      quarter: pensionCompetences.quarter,
      worker: pensionCompetences.workerCents,
      employer: pensionCompetences.employerCents,
      tfr: pensionCompetences.tfrCents,
    })
    .from(pensionCompetences)
    .where(and(userScoped(ctx).owns(pensionCompetences), inArray(pensionCompetences.fundId, [...bare])))
    .orderBy(asc(pensionCompetences.year), asc(pensionCompetences.quarter), asc(pensionCompetences.id));
  for (const row of accrued) {
    // Worker + employer + TFR, enrolment apart, exactly as the fund detail adds them up (GC §8.2).
    const cents = (row.worker ?? 0n) + (row.employer ?? 0n) + (row.tfr ?? 0n);
    if (cents === 0n) continue;
    // The money leaves on its quarter's deadline, whatever month the payslip was: a quarter still
    // running has accrued something and paid in nothing.
    const due = dueDate(row.year, row.quarter as Quarter, schedules.get(row.fundId) ?? COMETA_SCHEDULE);
    if (due === null || due > todayOn) continue;
    add(row.fundId, { on: due, chargedCents: cents, feeCents: 0n });
  }
  // A fund whose quarters are all still running has simply paid in nothing yet.
  for (const id of bare) if (!flows.has(id)) flows.set(id, []);
  return flows;
}

/** The transfer schedule in force for each fund, the provider's own when none is recorded. */
async function paymentSchedules(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
): Promise<Map<string, ScheduleEntry[]>> {
  const rows = await getDb()
    .select({ fundId: pensionRules.fundId, schedule: pensionRules.schedule })
    .from(pensionRules)
    .where(
      and(
        userScoped(ctx).owns(pensionRules),
        inArray(pensionRules.fundId, [...fundIds]),
        eq(pensionRules.kind, "payment_schedule"),
      ),
    )
    .orderBy(asc(pensionRules.fundId), desc(pensionRules.validFrom), asc(pensionRules.id));
  const out = new Map<string, ScheduleEntry[]>();
  // Ordered newest first per fund: the first row of each is the one in force. A row that stores
  // nothing readable is no schedule at all, and the provider's own is used instead.
  for (const row of rows) {
    if (out.has(row.fundId)) continue;
    const schedule = parseSchedule(row.schedule);
    if (schedule.length > 0) out.set(row.fundId, schedule);
  }
  return out;
}

/** Days after the charge day before a missing deposit is worth saying (plan F4 §3.6.7). */
export const DEPOSIT_GRACE_DAYS = 3;

/** The design's "This month" pill: a deposit found this month, one still awaited, or one missing. */
export type MonthStatus =
  | { kind: "found"; on: CivilDate }
  | { kind: "awaited" }
  | { kind: "missing"; by: CivilDate }
  | { kind: "none" };

function monthStatus(fund: Fund, deposits: readonly FundDeposit[], todayOn: CivilDate): MonthStatus {
  const thisMonth = monthKey(todayOn);
  const found = deposits
    .filter((deposit) => monthKey(deposit.on) === thisMonth)
    .sort((a, b) => (a.on < b.on ? 1 : -1))[0];
  if (found) return { kind: "found", on: found.on };
  if (fund.state !== "active" || fund.debitDay === null || fund.monthlyCents === null)
    return { kind: "none" };
  const last = Number(addDays(addMonths(thisMonth, 1), -1).slice(8));
  const due = `${thisMonth.slice(0, 8)}${String(Math.min(fund.debitDay, last)).padStart(2, "0")}`;
  const by = addDays(due, DEPOSIT_GRACE_DAYS);
  return todayOn > by ? { kind: "missing", by } : { kind: "awaited" };
}

export interface FundRow {
  fund: Fund;
  metrics: FundMetrics;
  lastValuation: CivilDate | null;
  month: MonthStatus;
  debitAccountName: string | null;
}

export interface FundsView {
  rows: FundRow[];
  archived: Fund[];
  valueCents: Cents | null;
  paidInCents: Cents;
  gainCents: Cents | null;
  monthlyCents: Cents;
  months: MonthKey[];
  /** Value of the open funds at each month end (held), and what had been paid in by then. */
  valueSeries: (Cents | null)[];
  paidSeries: Cents[];
}

async function depositsOf(
  ctx: Pick<Ctx, "userId">,
  fundIds: readonly string[],
): Promise<Map<string, FundDeposit[]>> {
  if (fundIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(fundDeposits)
    .where(and(userScoped(ctx).owns(fundDeposits), inArray(fundDeposits.fundId, [...fundIds])))
    .orderBy(desc(fundDeposits.on), desc(fundDeposits.id));
  const byFund = new Map<string, FundDeposit[]>();
  for (const row of rows) byFund.set(row.fundId, [...(byFund.get(row.fundId) ?? []), row]);
  return byFund;
}

/** The Funds list (spec §7.7, design): KPIs, the combined chart, one row per fund, the totals. */
export async function fundsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<FundsView> {
  const todayOn = today(ctx.timeZone, now);
  const all = await getDb()
    .select()
    .from(funds)
    .where(userScoped(ctx).owns(funds))
    .orderBy(asc(funds.name), asc(funds.id));
  const open = all.filter((fund) => fund.state === "active");
  const [deposits, values, accounts, chart, lastEntries] = await Promise.all([
    depositsOf(
      ctx,
      open.map((fund) => fund.id),
    ),
    balancesOn(
      ctx,
      open.map((fund) => fund.valuationAccountId),
      todayOn,
    ),
    listAccounts(ctx, { includeArchived: true }),
    accountsView(ctx, { now, months: 12 }),
    open.length === 0
      ? []
      : getDb()
          .select({ fundId: fundValuations.fundId, balanceEntryId: fundValuations.balanceEntryId })
          .from(fundValuations)
          .where(
            and(
              userScoped(ctx).owns(fundValuations),
              inArray(
                fundValuations.fundId,
                open.map((fund) => fund.id),
              ),
            ),
          ),
  ]);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const entryDates = new Map<string, CivilDate>();
  // A pension fund's value is the one its statement documents, with the statement's own date
  // (GC §12) — never "as of today", which would leave a fund valued only in the future blank.
  const statementValues = new Map<string, Cents>();
  for (const fund of open) {
    const entries = await listBalanceEntries(ctx, fund.valuationAccountId, 50);
    if (fund.type === "pension") {
      const latest = entries[0];
      if (latest) {
        entryDates.set(fund.id, latest.on);
        statementValues.set(fund.id, latest.balanceCents);
      }
      continue;
    }
    const ids = new Set(lastEntries.filter((row) => row.fundId === fund.id).map((row) => row.balanceEntryId));
    const latest = entries.find((entry) => ids.has(entry.id));
    if (latest) entryDates.set(fund.id, latest.on);
  }

  const inflowsByFund = await pensionInflows(
    ctx,
    open.filter((fund) => fund.type === "pension").map((fund) => fund.id),
    todayOn,
  );
  const rows: FundRow[] = open.map((fund) => {
    const own = deposits.get(fund.id) ?? [];
    const value =
      fund.type === "pension"
        ? (statementValues.get(fund.id) ?? null)
        : (values.get(fund.valuationAccountId) ?? null);
    // The value's own day: a PAC's debits are picked up on their own, its value only when somebody
    // records one, so every percentage is measured against what had been paid in by then.
    const base = fundMetrics(own, value, entryDates.get(fund.id) ?? null);
    const inflows = inflowsByFund.get(fund.id) ?? [];
    const paidIn = inflows.reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
    const fees = inflows.reduce<Cents>((sum, flow) => sum + flow.feeCents, 0n);
    // The gain is measured against what had gone in *by the date of the value*, whether the fund's
    // own operations said so or the transfer schedule did: money that left afterwards is not
    // inside the position it would be compared to. With nothing gone in, a value is a position and
    // not a gain, so it stays unknown rather than being claimed whole (owner, 2026-09-20).
    const valueOn = entryDates.get(fund.id) ?? null;
    const basis = inflows
      .filter((flow) => valueOn === null || flow.on <= valueOn)
      .reduce<Cents>((sum, flow) => sum + flow.chargedCents, 0n);
    return {
      fund,
      metrics:
        fund.type === "pension"
          ? {
              ...base,
              paidInCents: paidIn,
              feesCents: fees,
              investedCents: paidIn - fees,
              gainCents: value === null || basis === 0n ? null : value - basis,
              gainFraction:
                value === null || basis === 0n
                  ? null
                  : Number(((value - basis) * 1_000_000_000n) / basis) / 1_000_000_000,
            }
          : base,
      lastValuation: entryDates.get(fund.id) ?? null,
      month: monthStatus(fund, own, todayOn),
      debitAccountName: fund.debitAccountId ? (accountName.get(fund.debitAccountId) ?? null) : null,
    };
  });
  const known = rows.filter((row) => row.metrics.valueCents !== null);
  const valueCents =
    known.length === 0 ? null : known.reduce((sum, row) => sum + (row.metrics.valueCents ?? 0n), 0n);
  const paidInCents = rows.reduce((sum, row) => sum + row.metrics.paidInCents, 0n);

  const series = chart.rows.filter((row) => open.some((fund) => fund.valuationAccountId === row.account.id));
  const valueSeries = chart.months.map((_, index) =>
    series.reduce<Cents | null>((sum, row) => {
      const value = row.held[index];
      return value === null ? sum : (sum ?? 0n) + value;
    }, null),
  );
  // The pension funds' credits count in the combined "paid in" line too (GC §12) — and, while a
  // fund has no export of its own, what its payslips accrued stands in for them.
  const allDeposits = [
    ...[...deposits.values()].flat(),
    ...[...inflowsByFund.values()]
      .flat()
      .map((flow) => ({ on: flow.on, chargedCents: flow.chargedCents, feeCents: flow.feeCents })),
  ];
  const basisCents = rows.reduce((sum, row) => sum + row.metrics.gainBasisCents, 0n);
  return {
    rows,
    archived: all.filter((fund) => fund.state === "archived"),
    valueCents,
    paidInCents,
    // Measured the same way as each row's: only what had been paid in by each fund's own value.
    gainCents: valueCents === null ? null : valueCents - basisCents,
    monthlyCents: open.reduce((sum, fund) => sum + (fund.monthlyCents ?? 0n), 0n),
    months: chart.months,
    valueSeries,
    paidSeries: cumulativeAt(allDeposits, chart.months),
  };
}

export interface ValuationRow {
  id: string;
  balanceEntryId: string;
  on: CivilDate;
  valueCents: Cents;
  units: string | null;
  note: string | null;
  /** What had been paid in by that day. */
  paidInCents: Cents;
}

export interface FundDetail {
  fund: Fund;
  accountName: string;
  debitAccountName: string | null;
  metrics: FundMetrics;
  deposits: FundDeposit[];
  valuations: ValuationRow[];
  months: MonthKey[];
  valueSeries: (Cents | null)[];
  paidSeries: Cents[];
  /** One Simple Dietz return per month of `months` (spec §7.7). */
  /** What the fund did between one documented value and the next (spec §7.7). */
  periods: PeriodReturn[];
  stats: ReturnType<typeof periodStats>;
  forecast: FundForecast;
  month: MonthStatus;
  rule: typeof fundDepositRules.$inferSelect | null;
  accounts: { id: string; name: string }[];
}

/** One fund's page (spec §7.7, design): the four tabs read once. `span` is the chart's months. */
export async function fundDetail(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  span = 12,
  now: Date = new Date(),
): Promise<FundDetail> {
  const todayOn = today(ctx.timeZone, now);
  const [fund] = await getDb()
    .select()
    .from(funds)
    .where(and(eq(funds.id, id), userScoped(ctx).owns(funds)));
  if (!fund) throw new FundError("not_found");
  const account = await getAccount(ctx, fund.valuationAccountId);
  const [deposits, value, chart, entries, valuationRows, [rule], accounts] = await Promise.all([
    depositsOf(ctx, [id]).then((map) => map.get(id) ?? []),
    balancesOn(ctx, [fund.valuationAccountId], todayOn).then(
      (map) => map.get(fund.valuationAccountId) ?? null,
    ),
    accountsView(ctx, { now, months: Math.max(span, 12) + 1 }),
    listBalanceEntries(ctx, fund.valuationAccountId, 500),
    getDb()
      .select()
      .from(fundValuations)
      .where(and(eq(fundValuations.fundId, id), userScoped(ctx).owns(fundValuations))),
    getDb()
      .select()
      .from(fundDepositRules)
      .where(and(eq(fundDepositRules.fundId, id), userScoped(ctx).owns(fundDepositRules))),
    listAccounts(ctx),
  ]);
  const row = chart.rows.find((one) => one.account.id === fund.valuationAccountId);
  const held = row?.held ?? chart.months.map(() => null);
  const months = chart.months.slice(-span);
  const valueSeries = held.slice(-span);
  // What the fund did between one documented value and the next. Month by month against a value
  // held forward from the last document, the month a deposit landed read as a loss of its own size
  // (owner, 2026-09-20): a return needs two documented ends.
  const returnMonths = chart.months.slice(-12);
  const byEntry = new Map(valuationRows.map((valuation) => [valuation.balanceEntryId, valuation]));
  const valuations: ValuationRow[] = entries
    .filter((entry) => byEntry.has(entry.id))
    .map((entry) => {
      const valuation = byEntry.get(entry.id)!;
      return {
        id: valuation.id,
        balanceEntryId: entry.id,
        on: entry.on,
        valueCents: entry.balanceCents,
        units: valuation.units,
        note: valuation.note,
        paidInCents: cumulativeAt(
          deposits.filter((deposit) => deposit.on <= entry.on),
          [monthKey(entry.on)],
        )[0],
      };
    });
  const periods = periodReturns(
    valuations.map((row) => ({ on: row.on, cents: row.valueCents })),
    deposits,
  );
  const names = new Map(accounts.map((one) => [one.id, one.name]));
  const metrics = fundMetrics(deposits, value, valuations[0]?.on ?? null);
  return {
    fund,
    accountName: account?.name ?? "",
    debitAccountName: fund.debitAccountId ? (names.get(fund.debitAccountId) ?? null) : null,
    metrics,
    deposits,
    valuations,
    months,
    valueSeries,
    paidSeries: cumulativeAt(deposits, months),
    periods,
    stats: periodStats(periods),
    forecast: fundForecast({
      valueCents: value,
      paidInCents: metrics.paidInCents,
      flows: deposits,
      months: returnMonths,
      ownRate: annualisedOverPeriods(periods),
    }),
    month: monthStatus(fund, deposits, todayOn),
    rule: rule ?? null,
    accounts: accounts.map((one) => ({ id: one.id, name: one.name })),
  };
}

/** The accounts that can hold a new fund's value: this user's open manual ones no fund uses yet. */
export async function valuationAccountOptions(
  ctx: Pick<Ctx, "userId">,
): Promise<{ id: string; name: string }[]> {
  const [accounts, used] = await Promise.all([
    listAccounts(ctx),
    getDb().select({ id: funds.valuationAccountId }).from(funds).where(userScoped(ctx).owns(funds)),
  ]);
  const taken = new Set(used.map((row) => row.id));
  return accounts
    .filter((account) => account.origin === "manual" && !taken.has(account.id))
    .map((account) => ({ id: account.id, name: account.name }));
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
