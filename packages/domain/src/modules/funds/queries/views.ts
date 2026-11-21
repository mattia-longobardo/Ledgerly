// The views of Funds (rewrite plan R2, 05-refactor.md §5.5 «funds»; audit FND-1, FND-3): the home of
// a period and the four tabs of a fund, composed once from the one engine of the period. The routes
// and the tools `get_funds`, `get_fund` answer from these; nothing here formats or translates.
import { listAccounts } from "../../accounts";
import type { Ctx } from "../../../platform/context";
import { type CivilDate, isCivilDate, today } from "../../../shared/dates";
import type { Cents } from "../../../shared/money";
import { periodSpan } from "../../../shared/period";
import { fundSummary, hypothesesOnly } from "../detail";
import { fundHomeRow, fundsHomeRows } from "../home-queries";
import {
  firstDataOn,
  gainBars,
  gainGrain,
  homeSummary,
  lineValue,
  staleFunds,
  valueSeries,
  valueToday,
  yearRows,
} from "../home";
import { allPeriod, type FundPeriod, yearPeriod } from "../period";
import {
  accruedNote,
  assetsEstimate,
  contributionDefaults,
  firstPaidOn,
  firstValueOn,
  gainChart,
  newestPoint,
  operationsIn,
  payslipLines,
  recentOperations,
  registerTotals,
  voluntaryIn,
} from "./figures";
import { arrangeFees } from "../fees";
import { calendarOf } from "./detail";
import { hasPayrollCalendar } from "./lists";
import { FundError, takenComponents } from "../service";
import { hasDueDates, nextDueDates } from "../sources";
import { FUND_TEMPLATES } from "../templates";
import {
  bestAndWorst,
  closesPeriodBefore,
  inPeriod,
  quarterInPeriod,
  readsPeriod,
  valuationLines,
} from "../tabs";

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

/** The charts of a period; `header` is the gain and the rate the Return view divides by. */
const chartOf = (
  lines: Parameters<typeof valueSeries>[0],
  period: ViewPeriod,
  firstOn: CivilDate | null,
  header: { totalCents: Cents | null; rate: number | null },
) => {
  const span = periodSpan(period, firstOn);
  const grain = gainGrain(period, span);
  const bars = gainBars(lines, span, grain);
  return {
    grain,
    bars,
    chart: gainChart(
      bars.map((bar) => bar.totalCents),
      header.totalCents,
      header.rate,
    ),
    values: valueSeries(lines),
  };
};

type Row = Awaited<ReturnType<typeof fundHomeRow>>;

/** What a fund's sources say as of today: its active recurring debit and what is on its way. */
const asOfToday = (row: Row) => ({
  debit: row.detail.debits.find((one) => one.source.state === "active") ?? null,
  hasCalendar: hasPayrollCalendar(row.detail),
  onTheWay: { cents: row.onTheWayCents, periods: row.onTheWay },
});

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
  const detailOf = new Map(rows.map((row) => [row.fund.id, row.detail]));
  const open = rows.filter((row) => row.fund.state === "active");
  return {
    period,
    firstOn,
    summary,
    voluntaryCents: voluntaryIn(summary.lines, detailOf, period),
    valueToday: valueToday(homes, todayOn),
    funds: rows.map((row) => {
      const line = summary.lines.find((one) => one.fund.id === row.fund.id) ?? null;
      return {
        row,
        line,
        voluntaryCents: line === null ? 0n : voluntaryIn([line], detailOf, period),
        lineValueCents: line === null ? null : lineValue(line, period, todayOn),
        valueToday: valueToday([row.home], todayOn),
        stale: stale.has(row.fund.id),
        lastValueOn: newestPoint(row.home)?.on ?? null,
        ...asOfToday(row),
      };
    }),
    // "On the way" in the header: the open funds only, and only when one has a payslip calendar.
    onTheWayCents: open.reduce<Cents>((sum, row) => sum + row.onTheWayCents, 0n),
    awaitsPayslips: open.some((row) => hasPayrollCalendar(row.detail)),
    firstValueOn: firstValueOn(homes),
    firstPaidOn: firstPaidOn(homes),
    accrued: accruedNote(summary.lines, periodSpan(period, firstOn)),
    valuesSeen: summary.lines.filter((line) => lineValue(line, period, todayOn) !== null).length,
    ...chartOf(summary.lines, period, firstOn, { totalCents: summary.gainCents, rate: summary.rate }),
    years:
      period.kind === "all"
        ? yearRows(homes, todayOn, firstOn).map((year) => ({
            ...year,
            voluntaryCents: voluntaryIn(year.summary.lines, detailOf, yearPeriod(year.year, todayOn)),
          }))
        : [],
  };
}

/** One fund read as the home reads it, measured in a period: what every tab of a fund starts from. */
async function fundInPeriod(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now: Date,
) {
  const todayOn = today(ctx.timeZone, now);
  const row = await fundHomeRow(ctx, id, now);
  return { todayOn, row, ...fundSummary({ fund: row.home, period, todayOn }) };
}

/** A fund's Overview in a period: the same line as its row in the home. */
export async function fundOverviewView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const { todayOn, row, firstOn, summary, line, beforeFirst } = await fundInPeriod(ctx, id, period, now);
  const { detail, home } = row;
  const detailOf = new Map([[row.fund.id, detail]]);
  const current = asOfToday(row);
  return {
    row,
    period,
    firstOn,
    beforeFirst,
    summary,
    summaryVoluntaryCents: voluntaryIn(summary.lines, detailOf, period),
    line,
    lineVoluntaryCents: voluntaryIn([line], detailOf, period),
    lineValueCents: lineValue(line, period, todayOn),
    valueToday: valueToday([home], todayOn),
    valueTodayOn: newestPoint(home)?.on ?? null,
    firstPaidOn: firstPaidOn([home]),
    firstValueOn: firstValueOn([home]),
    ...unitsAndPayslips(detail),
    ...current,
    recent: recentOperations(operationsIn(detail, period)),
    operationsEver: detail.operations.length,
    competencesEver: detail.competences.length,
    valuesEver: home.points.length,
    ...chartOf([line], period, firstOn, { totalCents: line.measure.gainCents, rate: line.measure.rate }),
    forecast: hypothesesOnly(detail.forecast),
    projection: projectionOf(row, current.debit),
  };
}

/** Units and their price, for a fund with unit movements; the payslips' side, for one with a payslip source. */
function unitsAndPayslips(detail: Row["detail"]) {
  const hasUnits = detail.movements.length > 0;
  const payroll = detail.payroll !== null;
  return {
    units: hasUnits ? detail.metrics.units : null,
    lastPrice: hasUnits ? detail.metrics.lastPrice : null,
    bridge: payroll ? { lines: detail.bridge, on: detail.metrics.value?.on ?? null } : null,
    payslipsAccruedCents: payroll ? detail.metrics.accruedCents : null,
  };
}

/** A fund fed by a recurring debit alone has the short projection, on its plan while it runs. */
function projectionOf(row: Row, debit: ReturnType<typeof asOfToday>["debit"]) {
  const short = debit !== null && row.detail.payroll === null;
  const plan = short && row.fund.state === "active" && debit.source.amountCents !== null;
  return {
    layout: short ? ("short" as const) : ("closed" as const),
    basis: plan ? ("plan" as const) : ("average" as const),
  };
}

/** A fund's Valuations tab: the readings of the period against the reading before. */
export async function fundValuationsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const { row, firstOn, line } = await fundInPeriod(ctx, id, period, now);
  const lines = valuationLines(line, period);
  const lastValue = newestPoint(row.home);
  return {
    row,
    period,
    firstOn,
    lines,
    ...bestAndWorst(lines),
    recorded: row.detail.valuations,
    valuesEver: row.home.points.length,
    lastValue,
    lastValueClosesPrevious: lastValue !== null && closesPeriodBefore(lastValue.on, period),
    notInValueCents: line.measure.notInValueCents,
    statements: row.detail.snapshots.filter((one) => readsPeriod(one.valuationDate, period)),
  };
}

/** A fund's Contributions tab: the register of the period and the periods of its payslip source. */
export async function fundContributionsView(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  id: string,
  period: ViewPeriod,
  now = new Date(),
) {
  const { row, firstOn, todayOn } = await fundInPeriod(ctx, id, period, now);
  const { detail } = row;
  const accrualPeriod = detail.payroll?.period ?? "quarter";
  const operations = operationsIn(detail, period);
  return {
    row,
    period,
    firstOn,
    operations,
    totals: registerTotals(operations),
    operationsEver: detail.operations.length,
    fedBySources: detail.sources.some((source) => source.kind !== "manual"),
    payslips: payslipLines(detail, period),
    periods: detail.quarters.filter((quarter) => quarterInPeriod(quarter, period, accrualPeriod)),
    hasCalendar: hasPayrollCalendar(detail),
    accrued: row.home.accrued.filter((line) => inPeriod(line.on, period)),
    debit: detail.debits.find((one) => one.source.state === "active") ?? null,
    // An archived fund is read only: no dialog to open.
    setup: row.fund.state === "archived" ? null : contributionDefaults(detail, todayOn),
  };
}

/** A fund's Settings tab: its sources and fees, and what another fund's payslip source takes. */
export async function fundSettingsView(ctx: Pick<Ctx, "userId" | "timeZone">, id: string, now = new Date()) {
  const todayOn = today(ctx.timeZone, now);
  const row = await fundHomeRow(ctx, id, now);
  const [accounts, taken] = await Promise.all([listAccounts(ctx), takenComponents(ctx, { fundId: id })]);
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const { detail } = row;
  const nextDue = new Map(
    detail.sources.map((source) => {
      const calendar = calendarOf(source);
      const due =
        source.kind === "payroll" && source.accrualPeriod !== null && hasDueDates(calendar)
          ? nextDueDates(source.accrualPeriod, calendar, todayOn)
          : [];
      return [source.id, { due, entries: calendar.entries }] as const;
    }),
  );
  const fees = arrangeFees(detail.fees, todayOn);
  return {
    row,
    accountName,
    taken,
    nextDue,
    payrollSourceId: detail.payroll?.source.id ?? null,
    // The page's order: the fees in force first, by basis and by name, then the expired ones.
    fees: [
      ...fees.current.map((fee) => ({ fee, expired: false })),
      ...fees.expired.map((fee) => ({ fee, expired: true })),
    ],
    assetsEstimate: assetsEstimate(detail, todayOn),
  };
}

/** What the form that creates a fund starts from: the templates, and the components another fund takes. */
export async function fundSetupView(ctx: Pick<Ctx, "userId">) {
  return { templates: FUND_TEMPLATES, taken: await takenComponents(ctx) };
}
