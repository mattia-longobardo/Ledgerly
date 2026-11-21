// Funds · the one serializer of the home and a fund's Overview (audit API-2, FND-3): the routes and the
// tools `get_funds` and `get_fund` answer through these. The numbers are the views'
// (`@ledgerly/domain/funds`); here they only change form, never value.
import type { z } from "zod";
import type { FUNDS } from "@ledgerly/api-contract";
import {
  type fundOverviewView,
  type fundsHomeView,
  operationGross,
  operationOrigin,
} from "@ledgerly/domain/funds";
import { type Cents, centsToDecimal } from "@ledgerly/domain/shared/money";

type Home = z.input<typeof FUNDS.funds.getFunds.response>;
type Overview = z.input<typeof FUNDS.funds.getFund.response>;
type HomeData = Awaited<ReturnType<typeof fundsHomeView>>;
type OverviewData = Awaited<ReturnType<typeof fundOverviewView>>;
type Row = OverviewData["row"];
type Summary = OverviewData["summary"];
type Line = OverviewData["line"];
type Detail = Row["detail"];

export const money = (cents: Cents): string => centsToDecimal(cents);
export const maybe = (cents: Cents | null): string | null => (cents === null ? null : centsToDecimal(cents));
const point = (value: { on: string; cents: Cents } | null) =>
  value === null ? null : { on: value.on, value: money(value.cents) };
const origin = (one: Summary["origin"], voluntaryCents: Cents) => ({
  you: money(one.youCents),
  employer: money(one.employerCents),
  tfr: money(one.tfrCents),
  other: money(one.otherCents),
  voluntary: money(voluntaryCents),
});

export function periodOut(period: HomeData["period"], firstOn: string | null) {
  return { kind: period.kind, year: period.year, from: period.from, to: period.to, firstOn };
}

export function fundRef(row: Row) {
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

function measureOut(summary: Summary, voluntaryCents: Cents) {
  return {
    state: summary.state,
    gain: maybe(summary.gainCents),
    market: maybe(summary.marketCents),
    fees: money(summary.feesCents),
    feesPartial: summary.feesPartial,
    paidIn: money(summary.paidInCents),
    origin: origin(summary.origin, voluntaryCents),
    rate: summary.rate,
    xirr: summary.xirr,
    value: maybe(summary.valueCents),
    valueFrom: summary.valueFrom,
    valueTo: summary.valueTo,
    notInValue: money(summary.notInValueCents),
    accrued: money(summary.accruedCents),
  };
}

function lineOut(line: Line, voluntaryCents: Cents, valueCents: Cents | null) {
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
    origin: origin(measure.origin, voluntaryCents),
    notInValue: money(measure.notInValueCents),
    accrued: money(line.accruedCents),
    value: maybe(valueCents),
  };
}

const shareOf = (cents: Cents | null, scale: number | null) =>
  cents === null || scale === null ? null : Number(cents) * scale;

function chartOut(view: Pick<HomeData, "grain" | "bars" | "chart" | "values">) {
  const { cumulative, best, worst, scale } = view.chart;
  return {
    gain: {
      grain: view.grain,
      bars: view.bars.map((bar, index) => ({
        from: bar.from,
        to: bar.to,
        total: maybe(bar.totalCents),
        funds: [...bar.byFund].map(([fundId, cents]) => ({
          fundId,
          gain: money(cents),
          share: shareOf(cents, scale),
        })),
        stretches: bar.stretches.map((stretch) => ({
          fundId: stretch.fundId,
          from: stretch.from,
          to: stretch.to,
          gain: money(stretch.gainCents),
        })),
        cumulative: maybe(cumulative[index]),
        share: shareOf(bar.totalCents, scale),
        cumulativeShare: shareOf(cumulative[index], scale),
      })),
      best,
      worst,
    },
    values: view.values.map((one) => ({
      on: one.on,
      value: money(one.valueCents),
      paid: money(one.paidCents),
    })),
  };
}

/** A recurring debit and the state of its running period. */
export function debitOut(debit: Detail["debits"][number]) {
  const { source, plan, status } = debit;
  return {
    sourceId: source.id,
    state: source.state,
    amount: maybe(source.amountCents),
    frequency: plan.frequency,
    day: plan.day,
    status: status.kind,
    on: status.kind === "found" ? status.on : null,
    by: status.kind === "missing" ? status.by : null,
    accountId: source.accountId,
    accountName: debit.accountName,
    payeeMatch: source.payeeMatch,
  };
}

/** What a fund's sources say as of today: its active debit and what is on its way. */
function asOfTodayOut(today: Pick<HomeData["funds"][number], "debit" | "hasCalendar" | "onTheWay">) {
  return {
    debit: today.debit === null ? null : debitOut(today.debit),
    hasCalendar: today.hasCalendar,
    onTheWay: {
      amount: money(today.onTheWay.cents),
      periods: today.onTheWay.periods.map((one) => ({
        year: one.year,
        index: one.quarter,
        amount: money(one.cents),
        due: one.due,
      })),
    },
  };
}

/** One operation of the register, with what it moved and the badge of its origin. */
export const operationOut = (detail: Detail) => (one: Detail["operations"][number]) => ({
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
  gross: money(operationGross(one)),
  origin: operationOrigin(one, detail.sources),
});

/** The Funds home of a period. */
export function homeOut(view: HomeData): Home {
  return {
    period: periodOut(view.period, view.firstOn),
    valueToday: maybe(view.valueToday),
    summary: measureOut(view.summary, view.voluntaryCents),
    funds: view.funds.map((one) => ({
      ...fundRef(one.row),
      line: one.line === null ? null : lineOut(one.line, one.voluntaryCents, one.lineValueCents),
      valueToday: maybe(one.valueToday),
      stale: one.stale,
      lastValueOn: one.lastValueOn,
      ...asOfTodayOut(one),
    })),
    onTheWay: money(view.onTheWayCents),
    awaitsPayslips: view.awaitsPayslips,
    firstValueOn: view.firstValueOn,
    firstPaidOn: view.firstPaidOn,
    accrued: view.accrued,
    valuesSeen: view.valuesSeen,
    ...chartOut(view),
    years: view.years.map((year) => ({
      year: year.year,
      summary: measureOut(year.summary, year.voluntaryCents),
    })),
  };
}

/** A fund's Overview. */
export function overviewOut(view: OverviewData): Overview {
  const { forecast, row } = view;
  return {
    fund: fundRef(row),
    period: periodOut(view.period, view.firstOn),
    beforeFirst: view.beforeFirst,
    summary: measureOut(view.summary, view.summaryVoluntaryCents),
    line: lineOut(view.line, view.lineVoluntaryCents, view.lineValueCents),
    valueToday: maybe(view.valueToday),
    valueOlderThanOperations: row.detail.valueOlderThanOperations,
    ...chartOut(view),
    forecast: {
      monthly: money(forecast.monthlyCents),
      rates: forecast.rates,
      rows: forecast.rows.map((one) => ({
        years: one.years,
        paidIn: money(one.paidInCents),
        values: one.valueCents.map(maybe),
      })),
      ...view.projection,
    },
    valueTodayOn: view.valueTodayOn,
    firstPaidOn: view.firstPaidOn,
    firstValueOn: view.firstValueOn,
    units: view.units,
    lastPrice: view.lastPrice,
    bridge:
      view.bridge === null
        ? null
        : {
            lines:
              view.bridge.lines === null
                ? null
                : view.bridge.lines.map((one) => ({
                    key: one.key,
                    amount: money(one.cents),
                    total: one.total === true,
                  })),
            on: view.bridge.on,
          },
    payslipsAccrued: maybe(view.payslipsAccruedCents),
    ...asOfTodayOut(view),
    recent: view.recent.map(operationOut(row.detail)),
    operationsEver: view.operationsEver,
    competencesEver: view.competencesEver,
    valuesEver: view.valuesEver,
  };
}
