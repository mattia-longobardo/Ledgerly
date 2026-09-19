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
  cumulativeAt,
  flowsByMonth,
  fundMetrics,
  type FundMetrics,
  monthlyReturns,
  returnStats,
} from "./rules";
import { fundDeposits, fundDepositRules, funds, fundValuations } from "./schema";
import { type Fund, type FundDeposit, FundError } from "./service";

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
  for (const fund of open) {
    const entries = await listBalanceEntries(ctx, fund.valuationAccountId, 50);
    const ids = new Set(lastEntries.filter((row) => row.fundId === fund.id).map((row) => row.balanceEntryId));
    const latest = entries.find((entry) => ids.has(entry.id));
    if (latest) entryDates.set(fund.id, latest.on);
  }

  const rows: FundRow[] = open.map((fund) => {
    const own = deposits.get(fund.id) ?? [];
    return {
      fund,
      metrics: fundMetrics(own, values.get(fund.valuationAccountId) ?? null),
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
  const allDeposits = [...deposits.values()].flat();
  return {
    rows,
    archived: all.filter((fund) => fund.state === "archived"),
    valueCents,
    paidInCents,
    gainCents: valueCents === null ? null : valueCents - paidInCents,
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
  returns: (number | null)[];
  stats: ReturnType<typeof returnStats>;
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
  // Returns over the last 12 months: 13 month ends, the first being the end of the month before.
  const returnMonths = chart.months.slice(-12);
  const returns = monthlyReturns(returnMonths, held.slice(-13), flowsByMonth(deposits));
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
  const names = new Map(accounts.map((one) => [one.id, one.name]));
  return {
    fund,
    accountName: account?.name ?? "",
    debitAccountName: fund.debitAccountId ? (names.get(fund.debitAccountId) ?? null) : null,
    metrics: fundMetrics(deposits, value),
    deposits,
    valuations,
    months,
    valueSeries,
    paidSeries: cumulativeAt(deposits, months),
    returns,
    stats: returnStats(returns),
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
