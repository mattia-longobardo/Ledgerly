// The views of Funds (rewrite plan R2, 05-refactor.md §5.5 «funds»; audit FND-1, FND-3): the home of
// a period and the four tabs of a fund, composed once from the one engine of the period. The routes
// and the tools `get_funds`, `get_fund` answer from these; nothing here formats or translates.
import { listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, isCivilDate, today } from "../../../shared/dates";
import { periodSpan } from "../../../shared/period";
import { fundSummary, hypothesesOnly } from "../detail";
import { fundHomeRow, fundsHomeRows } from "../home-queries";
import {
  firstDataOn,
  gainBars,
  gainGrain,
  homeSummary,
  staleFunds,
  valueSeries,
  valueToday,
  yearRows,
} from "../home";
import { allPeriod, type FundPeriod, yearPeriod } from "../period";
import { hasPayrollCalendar } from "./lists";
import { FundError, takenComponents } from "../service";
import { bestAndWorst, inPeriod, quarterInPeriod, valuationLines } from "../tabs";

/** The period of a view: what the engine measures, and how the address named it. */
type ViewPeriod = FundPeriod & { kind: "year" | "all" | "custom"; year: number | null };

/**
 * The period of the routes (`period` = `all` | a year | `custom` with `from` and `to`; none is the
 * year running). A year after today's, or days that are not a period, are `invalid`: the page sends
 * such an address back to the year running instead.
 */
export function viewPeriod(
  query: { period?: string; from?: string; to?: string },
  todayOn: CivilDate,
): ViewPeriod {
  const { period } = query;
  if (period === "all") return { ...allPeriod(todayOn), kind: "all", year: null };
  if (period === "custom") return customPeriod(query.from, query.to, todayOn);
  const year = period === undefined ? Number(todayOn.slice(0, 4)) : Number(period);
  if (!Number.isInteger(year) || year > Number(todayOn.slice(0, 4)) || year < 1970)
    throw new FundError("invalid");
  return { ...yearPeriod(year, todayOn), kind: "year", year };
}

/** Days the picker wrote: real days, in order, starting by today; the end stops at today. */
function customPeriod(from: string | undefined, to: string | undefined, todayOn: CivilDate): ViewPeriod {
  const valid = from !== undefined && to !== undefined && isCivilDate(from) && isCivilDate(to);
  if (!valid || from > to || from > todayOn) throw new FundError("invalid");
  return { kind: "custom", year: null, from, to: to < todayOn ? to : todayOn };
}

const chartOf = (lines: Parameters<typeof valueSeries>[0], period: ViewPeriod, firstOn: CivilDate | null) => {
  const span = periodSpan(period, firstOn);
  const grain = gainGrain(period, span);
  return { grain, bars: gainBars(lines, span, grain), values: valueSeries(lines) };
};

/** The Funds home of a period: the portfolio's measure, each fund's line and the charts. */
export async function fundsHomeView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  period: ViewPeriod,
  now = new Date(),
) {
  const todayOn = today(ctx.timeZone, now);
  const rows = await fundsHomeRows(ctx, now);
  const homes = rows.map((row) => row.home);
  const firstOn = firstDataOn(homes);
  const summary = homeSummary({ funds: homes, period, todayOn, firstOn });
  const stale = new Set(staleFunds(homes, todayOn).map(({ fund }) => fund.id));
  return {
    period,
    firstOn,
    summary,
    valueToday: valueToday(homes, todayOn),
    funds: rows.map((row) => ({
      row,
      line: summary.lines.find((line) => line.fund.id === row.fund.id) ?? null,
      valueToday: valueToday([row.home], todayOn),
      stale: stale.has(row.fund.id),
    })),
    ...chartOf(summary.lines, period, firstOn),
    years: period.kind === "all" ? yearRows(homes, todayOn, firstOn) : [],
  };
}

/** A fund's Overview in a period: the same line as its row in the home. */
export async function fundOverviewView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const todayOn = today(ctx.timeZone, now);
  const row = await fundHomeRow(ctx, id, now);
  const { firstOn, summary, line, beforeFirst } = fundSummary({ fund: row.home, period, todayOn });
  return {
    row,
    period,
    firstOn,
    beforeFirst,
    summary,
    line,
    valueToday: valueToday([row.home], todayOn),
    ...chartOf([line], period, firstOn),
    forecast: hypothesesOnly(row.detail.forecast),
  };
}

/** A fund's Valuations tab: the readings of the period against the reading before. */
export async function fundValuationsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const todayOn = today(ctx.timeZone, now);
  const row = await fundHomeRow(ctx, id, now);
  const { firstOn, line } = fundSummary({ fund: row.home, period, todayOn });
  const lines = valuationLines(line, period);
  return { row, period, firstOn, lines, ...bestAndWorst(lines), recorded: row.detail.valuations };
}

/** A fund's Contributions tab: the register of the period and the periods of its payslip source. */
export async function fundContributionsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const todayOn = today(ctx.timeZone, now);
  const row = await fundHomeRow(ctx, id, now);
  const { detail } = row;
  const { firstOn } = fundSummary({ fund: row.home, period, todayOn });
  const accrualPeriod = detail.payroll?.period ?? "quarter";
  return {
    row,
    period,
    firstOn,
    operations: detail.operations.filter((operation) => inPeriod(operation.operationDate, period)),
    periods: detail.quarters.filter((quarter) => quarterInPeriod(quarter, period, accrualPeriod)),
    hasCalendar: hasPayrollCalendar(detail),
    accrued: row.home.accrued.filter((line) => inPeriod(line.on, period)),
    debit: detail.debits.find((one) => one.source.state === "active") ?? null,
  };
}

/** A fund's Settings tab: its sources and fees, and what another fund's payslip source takes. */
export async function fundSettingsView(ctx: Pick<Ctx, "userId" | "timeZone">, id: string, now = new Date()) {
  const row = await fundHomeRow(ctx, id, now);
  const [accounts, taken] = await Promise.all([listAccounts(ctx), takenComponents(ctx, { fundId: id })]);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  return { row, accountName, taken };
}
