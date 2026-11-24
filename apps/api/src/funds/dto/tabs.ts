// Funds · the one serializer of a fund's other tabs, of what a removal hands back and of the reads of
// the forms (audit API-2, FND-3). The numbers are the views'; here they only change form, never value.
import type { z } from "zod";
import type { FUNDS } from "@ledgerly/api-contract";
import type {
  FundFee,
  FundSource,
  fundContributionsView,
  fundSettingsView,
  fundSetupView,
  fundValuationsView,
  movementCandidates,
} from "@ledgerly/domain/funds";
import { fractionToPercent } from "@ledgerly/domain/interests";
import { kindOf } from "@ledgerly/domain/payroll";
import { debitOut, fundRef, maybe, money, operationOut, periodOut } from "./home";

type Valuations = z.input<typeof FUNDS.funds.getFundValuations.response>;
type Contributions = z.input<typeof FUNDS.funds.getFundContributions.response>;
type Settings = z.input<typeof FUNDS.funds.getFundSettings.response>;
type Setup = z.input<typeof FUNDS.funds.getFundSetup.response>;
type Candidates = z.input<typeof FUNDS.funds.getFundMovementCandidates.response>;

type ValuationsData = Awaited<ReturnType<typeof fundValuationsView>>;
type ValuationLine = ValuationsData["lines"][number];

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
export function valuationsOut(view: ValuationsData): Valuations {
  const recordedOn = new Map(view.recorded.map((one) => [one.on, one.id]));
  return {
    fundId: view.row.fund.id,
    period: periodOut(view.period, view.firstOn, view.span),
    beforeFirst: view.beforeFirst,
    lines: view.lines.map((line) => ({
      ...valuationLineOut(line),
      valuationId: recordedOn.get(line.on) ?? null,
    })),
    best: view.best === null ? null : valuationLineOut(view.best),
    worst: view.worst === null ? null : valuationLineOut(view.worst),
    recorded: view.recorded.map((one) => ({
      id: one.id,
      on: one.on,
      value: money(one.valueCents),
      units: one.units,
      note: one.note,
    })),
    valuesEver: view.valuesEver,
    lastValue: view.lastValue === null ? null : { on: view.lastValue.on, value: money(view.lastValue.cents) },
    lastValueClosesPrevious: view.lastValueClosesPrevious,
    notInValue: money(view.notInValueCents),
    statements: view.statements.map((one) => ({
      id: one.id,
      on: one.valuationDate,
      value: money(one.valueCents),
      worker: maybe(one.workerCents),
      employer: maybe(one.employerCents),
      tfr: maybe(one.tfrCents),
      inflows: maybe(one.inflowsCents),
      outflows: maybe(one.outflowsCents),
      reportedGain: maybe(one.reportedGainCents),
    })),
  };
}

type ContributionsData = Awaited<ReturnType<typeof fundContributionsView>>;
type Detail = ContributionsData["row"]["detail"];

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
    lastCreditedOn: quarter.operationDates.at(-1) ?? null,
    fees: money(quarter.feesCents),
    net: money(quarter.netCents),
    payslips: payslips
      .filter((id) => id !== undefined)
      .map((payslipId) => ({ payslipId, documentId: detail.payslipDocuments.get(payslipId) ?? null })),
  };
};

/** The state of the active debit, as the tab answered it before `debits`. */
function activeDebitOut(debit: ContributionsData["debit"]) {
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

/** The payslips of the period and their total row. */
function payslipsOut(detail: Detail, payslips: ContributionsData["payslips"]) {
  return {
    payslips: payslips.lines.map(({ competence, quarter, index, totalCents }) => ({
      competenceId: competence.id,
      payslipId: competence.payslipId,
      documentId: detail.payslipDocuments.get(competence.payslipId) ?? null,
      month: competence.payrollPeriod,
      payslipType: competence.payslipType,
      // shortcut: the competence stores the old type only; kind from it until R5f stores the kind.
      ...kindOf({
        type: competence.payslipType,
        kind: null,
        extraNumber: null,
      }),
      year: competence.year,
      index,
      worker: maybe(competence.workerCents),
      employer: maybe(competence.employerCents),
      tfr: maybe(competence.tfrCents),
      total: money(totalCents),
      status: quarter?.status ?? null,
      reason: quarter?.reason ?? null,
    })),
    payslipTotals: {
      worker: money(payslips.totals.workerCents),
      employer: money(payslips.totals.employerCents),
      tfr: money(payslips.totals.tfrCents),
      total: money(payslips.totals.totalCents),
    },
  };
}

/** What «Record contribution» opens with. */
function contributionSetupOut(setup: ContributionsData["setup"]) {
  if (setup === null) return null;
  return {
    defaultKind: setup.kind,
    defaultFees: { voluntary: money(setup.voluntaryFeeCents), payroll: money(setup.payrollFeeCents) },
    periods: setup.periods,
    pendingPeriod: setup.pending,
  };
}

/** The register's total row. */
const totalsOut = (totals: ContributionsData["totals"]) => ({
  worker: money(totals.workerCents),
  employer: money(totals.employerCents),
  tfr: money(totals.tfrCents),
  voluntary: money(totals.voluntaryCents),
  other: money(totals.otherCents),
  fees: money(totals.feesCents),
  net: money(totals.netCents),
});

/** A fund's Contributions tab. */
export function contributionsOut(view: ContributionsData): Contributions {
  const { detail } = view.row;
  const payroll = detail.payroll;
  return {
    fundId: detail.fund.id,
    fund: fundRef(view.row),
    period: periodOut(view.period, view.firstOn, view.span),
    beforeFirst: view.beforeFirst,
    operations: view.operations.map(operationOut(detail)),
    totals: totalsOut(view.totals),
    operationsEver: view.operationsEver,
    fedBySources: view.fedBySources,
    ...payslipsOut(detail, view.payslips),
    payroll:
      payroll === null
        ? null
        : {
            accrualPeriod: payroll.period,
            components: payroll.source.components ?? [],
            hasCalendar: view.hasCalendar,
            toleranceDays: payroll.toleranceDays,
            periods: view.periods.map(periodStatusOut(detail)),
            onTheWay: money(view.row.onTheWayCents),
          },
    accrued: view.accrued.map((one) => ({ on: one.on, amount: money(one.cents), dueOn: one.dueOn })),
    debit: activeDebitOut(view.debit),
    debits: detail.debits.map(debitOut),
    setup: contributionSetupOut(view.setup),
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
  const estimate = view.assetsEstimate;
  return {
    fund: fundRef(view.row),
    sources: detail.sources.map((one) => {
      const due = view.nextDue.get(one.id);
      return {
        ...sourceOut(one, nameOf(one.accountId), detail.sourceContributions.get(one.id) ?? 0),
        nextDue: due?.due ?? [],
        dueDates: [...(due?.entries ?? [])],
      };
    }),
    fees: view.fees.map(({ fee, expired }) => ({ ...feeOut(fee), expired })),
    codes: detail.codes,
    taken: [...view.taken].map(([component, fund]) => ({ component, fund })),
    payrollSourceId: view.payrollSourceId,
    assetsEstimate: {
      state: estimate.state,
      amount: estimate.cost === null ? null : money(estimate.cost.cents),
      rate: estimate.cost?.rate ?? null,
      value: estimate.value === null ? null : money(estimate.value.cents),
      on: estimate.value?.on ?? null,
    },
  };
}

/** What the form that creates a fund starts from. */
export function setupOut(view: Awaited<ReturnType<typeof fundSetupView>>): Setup {
  return {
    templates: view.templates.map((one) => ({ ...one })),
    taken: [...view.taken].map(([component, fund]) => ({ component, fund })),
  };
}

/** The movements a contribution or a debit can be tied to. */
export function candidatesOut(found: Awaited<ReturnType<typeof movementCandidates>>): Candidates {
  return {
    movements: found.map((one) => ({ id: one.id, on: one.on, payee: one.payee, amount: money(one.cents) })),
  };
}
