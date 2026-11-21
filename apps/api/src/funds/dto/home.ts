// Funds · the one serializer of the home, a fund's tabs and what a removal hands back (audit API-2,
// FND-3): the routes and the tools `get_funds` and `get_fund` answer through these. The numbers are
// the views' (`@ledgerly/domain/funds`); here they only change form, never value.
import type { z } from "zod";
import type { FUNDS } from "@ledgerly/api-contract";
import type {
  FundFee,
  FundSource,
  fundContributionsView,
  fundOverviewView,
  fundSettingsView,
  fundsHomeView,
  fundValuationsView,
} from "@ledgerly/domain/funds";
import { fractionToPercent } from "@ledgerly/domain/interests";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Home = z.input<typeof FUNDS.funds.getFunds.response>;
type Overview = z.input<typeof FUNDS.funds.getFund.response>;
type Valuations = z.input<typeof FUNDS.funds.getFundValuations.response>;
type Contributions = z.input<typeof FUNDS.funds.getFundContributions.response>;
type Settings = z.input<typeof FUNDS.funds.getFundSettings.response>;
type HomeData = Awaited<ReturnType<typeof fundsHomeView>>;
type OverviewData = Awaited<ReturnType<typeof fundOverviewView>>;
type Row = OverviewData["row"];
type Summary = OverviewData["summary"];
type Line = OverviewData["line"];

const money = (cents: Cents): string => centsToDecimal(cents);
const maybe = (cents: Cents | null): string | null => (cents === null ? null : centsToDecimal(cents));
const point = (value: { on: string; cents: Cents } | null) =>
  value === null ? null : { on: value.on, value: money(value.cents) };
const origin = (one: Summary["origin"]) => ({
  you: money(one.youCents),
  employer: money(one.employerCents),
  tfr: money(one.tfrCents),
  other: money(one.otherCents),
});

function periodOut(period: HomeData["period"], firstOn: string | null) {
  return { kind: period.kind, year: period.year, from: period.from, to: period.to, firstOn };
}

function fundRef(row: Row) {
  const { fund, detail } = row;
  return {
    id: fund.id,
    name: fund.name,
    provider: fund.provider,
    compartment: fund.compartment,
    code: fund.code,
    startOn: fund.startOn,
    state: fund.state,
    currency: detail.currency,
    color: detail.color,
    accountId: fund.valuationAccountId,
    accountName: detail.accountName,
  };
}

function measureOut(summary: Summary) {
  return {
    state: summary.state,
    gain: maybe(summary.gainCents),
    market: maybe(summary.marketCents),
    fees: money(summary.feesCents),
    feesPartial: summary.feesPartial,
    paidIn: money(summary.paidInCents),
    origin: origin(summary.origin),
    rate: summary.rate,
    xirr: summary.xirr,
    value: maybe(summary.valueCents),
    valueFrom: summary.valueFrom,
    valueTo: summary.valueTo,
    notInValue: money(summary.notInValueCents),
    accrued: money(summary.accruedCents),
  };
}

function lineOut(line: Line) {
  const { measure } = line;
  return {
    fundId: line.fund.id,
    status: line.status,
    start: point(measure.start),
    end: point(measure.end),
    gain: maybe(measure.gainCents),
    market: maybe(measure.marketCents),
    fees: maybe(measure.feesCents),
    feesPartial: measure.feesPartial,
    rate: measure.rate,
    xirr: measure.xirr,
    paidIn: money(measure.paidInCents),
    origin: origin(measure.origin),
    notInValue: money(measure.notInValueCents),
    accrued: money(line.accruedCents),
  };
}

function chartOut(view: Pick<HomeData, "grain" | "bars" | "values">) {
  return {
    gain: {
      grain: view.grain,
      bars: view.bars.map((bar) => ({
        from: bar.from,
        to: bar.to,
        total: maybe(bar.totalCents),
        funds: [...bar.byFund].map(([fundId, cents]) => ({ fundId, gain: money(cents) })),
      })),
    },
    values: view.values.map((one) => ({
      on: one.on,
      value: money(one.valueCents),
      paid: money(one.paidCents),
    })),
  };
}

/** The Funds home of a period. */
export function homeOut(view: HomeData): Home {
  return {
    period: periodOut(view.period, view.firstOn),
    valueToday: maybe(view.valueToday),
    summary: measureOut(view.summary),
    funds: view.funds.map((one) => ({
      ...fundRef(one.row),
      line: one.line === null ? null : lineOut(one.line),
      valueToday: maybe(one.valueToday),
      stale: one.stale,
    })),
    ...chartOut(view),
    years: view.years.map((year) => ({ year: year.year, summary: measureOut(year.summary) })),
  };
}

/** A fund's Overview. */
export function overviewOut(view: OverviewData): Overview {
  const { forecast } = view;
  return {
    fund: fundRef(view.row),
    period: periodOut(view.period, view.firstOn),
    beforeFirst: view.beforeFirst,
    summary: measureOut(view.summary),
    line: lineOut(view.line),
    valueToday: maybe(view.valueToday),
    valueOlderThanOperations: view.row.detail.valueOlderThanOperations,
    ...chartOut(view),
    forecast: {
      monthly: money(forecast.monthlyCents),
      rates: forecast.rates,
      rows: forecast.rows.map((row) => ({
        years: row.years,
        paidIn: money(row.paidInCents),
        values: row.valueCents.map(maybe),
      })),
    },
  };
}

type ValuationLine = Awaited<ReturnType<typeof fundValuationsView>>["lines"][number];

const valuationLineOut = (line: ValuationLine) => ({
  on: line.on,
  value: money(line.valueCents),
  kind: line.kind,
  fromOn: line.fromOn,
  paid: maybe(line.paidCents),
  gain: maybe(line.gainCents),
  rate: line.rate,
});

/** A fund's Valuations tab. */
export function valuationsOut(view: Awaited<ReturnType<typeof fundValuationsView>>): Valuations {
  return {
    fundId: view.row.fund.id,
    period: periodOut(view.period, view.firstOn),
    lines: view.lines.map(valuationLineOut),
    best: view.best === null ? null : valuationLineOut(view.best),
    worst: view.worst === null ? null : valuationLineOut(view.worst),
    recorded: view.recorded.map((one) => ({
      id: one.id,
      on: one.on,
      value: money(one.valueCents),
      units: one.units,
      note: one.note,
    })),
  };
}

type ContributionsData = Awaited<ReturnType<typeof fundContributionsView>>;
type Detail = ContributionsData["row"]["detail"];

const operationOut = (detail: Detail) => (one: ContributionsData["operations"][number]) => ({
  id: one.id,
  on: one.operationDate,
  classification: one.classification,
  source: one.source,
  worker: money(one.workerCents),
  employer: money(one.employerCents),
  tfr: money(one.tfrCents),
  other: money(one.otherCents),
  fee: one.feesUnknown ? null : money(one.feesCents),
  net: money(one.netCents),
  units: detail.unitsOf.get(one.id) ?? null,
  competence:
    one.competenceYear === null || one.competenceQuarter === null
      ? null
      : { year: one.competenceYear, index: one.competenceQuarter },
  transactionId: one.transactionId,
  note: one.note,
});

/** One period of the payslip source, with the payslips its competences came from. */
const periodStatusOut = (detail: Detail) => (quarter: ContributionsData["periods"][number]) => {
  const payslipOf = new Map(detail.competences.map((one) => [one.id, one.payslipId]));
  const payslips = [
    ...new Set(quarter.components.flatMap((one) => one.competenceIds.map((id) => payslipOf.get(id)))),
  ];
  return {
    year: quarter.year,
    index: quarter.quarter,
    due: quarter.due,
    toleranceUntil: quarter.toleranceUntil,
    status: quarter.status,
    reason: quarter.reason,
    components: quarter.components.map((one) => ({
      component: one.component,
      accrued: maybe(one.accruedCents),
      credited: maybe(one.creditedCents),
      difference: maybe(one.differenceCents),
      status: one.status,
      decision:
        one.decision === null
          ? null
          : { note: one.decision.note, difference: money(one.decision.differenceCents) },
    })),
    missingMonths: quarter.missingMonths,
    fees: money(quarter.feesCents),
    net: money(quarter.netCents),
    payslips: payslips
      .filter((id) => id !== undefined)
      .map((payslipId) => ({ payslipId, documentId: detail.payslipDocuments.get(payslipId) ?? null })),
  };
};

function debitOut(debit: ContributionsData["debit"]) {
  if (debit === null) return null;
  const { status } = debit;
  return {
    sourceId: debit.source.id,
    status: status.kind,
    on: status.kind === "found" ? status.on : status.kind === "missing" ? status.by : null,
    amount: maybe(debit.source.amountCents),
    accountName: debit.accountName,
  };
}

/** A fund's Contributions tab. */
export function contributionsOut(view: ContributionsData): Contributions {
  const { detail } = view.row;
  const payroll = detail.payroll;
  return {
    fundId: detail.fund.id,
    period: periodOut(view.period, view.firstOn),
    operations: view.operations.map(operationOut(detail)),
    payroll:
      payroll === null
        ? null
        : {
            accrualPeriod: payroll.period,
            components: payroll.source.components ?? [],
            hasCalendar: view.hasCalendar,
            periods: view.periods.map(periodStatusOut(detail)),
            onTheWay: money(view.row.onTheWayCents),
          },
    accrued: view.accrued.map((one) => ({ on: one.on, amount: money(one.cents), dueOn: one.dueOn })),
    debit: debitOut(view.debit),
  };
}

/** A source as its form edits it, with the name of its account and how many contributions it has. */
export function sourceOut(source: FundSource, accountName: string | null, contributions: number) {
  return {
    id: source.id,
    kind: source.kind,
    state: source.state,
    components: source.components,
    accrualPeriod: source.accrualPeriod,
    employer: source.employer,
    due:
      source.dueDay === null || source.dueOffsetMonths === null
        ? null
        : { day: source.dueDay, offsetMonths: source.dueOffsetMonths },
    dueEntries: source.dueEntries ?? null,
    toleranceDays: source.toleranceDays,
    amount: maybe(source.amountCents),
    frequency:
      source.intervalCount === null || source.intervalUnit === null
        ? null
        : { count: source.intervalCount, unit: source.intervalUnit },
    debitDay: source.debitDay,
    accountId: source.accountId,
    accountName,
    payeeMatch: source.payeeMatch,
    validFrom: source.validFrom,
    validTo: source.validTo,
    note: source.note,
    contributions,
  };
}

/** A fee as its form edits it: the rate as a percentage. */
export function feeOut(fee: FundFee) {
  return {
    id: fee.id,
    label: fee.label,
    basis: fee.basis,
    amount: maybe(fee.amountCents),
    rate: fee.rate === null ? null : fractionToPercent(fee.rate),
    period: fee.period,
    sourceId: fee.sourceId,
    component: fee.component,
    validFrom: fee.validFrom,
    validTo: fee.validTo,
    note: fee.note,
  };
}

/** A fund's Settings tab. */
export function settingsOut(view: Awaited<ReturnType<typeof fundSettingsView>>): Settings {
  const { detail } = view.row;
  const nameOf = (id: string | null) => (id === null ? null : (view.accountName.get(id) ?? null));
  return {
    fund: fundRef(view.row),
    sources: detail.sources.map((one) =>
      sourceOut(one, nameOf(one.accountId), detail.sourceContributions.get(one.id) ?? 0),
    ),
    fees: detail.fees.map(feeOut),
    codes: detail.codes,
    taken: [...view.taken].map(([component, fund]) => ({ component, fund })),
  };
}
