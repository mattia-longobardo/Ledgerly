// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { fundSummary, hypothesesOnly, isFundId } from "./detail";
export {
  FEE_BASES,
  FEE_PERIODS,
  arrangeFees,
  assetsCost,
  contributionFee,
  feeModes,
  feeValidOn,
  needsPeriod,
  periodFees,
} from "./fees";
export type { FeeBasis, FeePeriod } from "./fees";
export {
  contributionFormOf,
  contributionInputOf,
  feeFormOf,
  feeInputOf,
  fractionOfPercent,
  fundInputOf,
  newContributionForm,
  newFeeForm,
  newSourceForm,
  parseScope,
  sourceFormOf,
  sourceInputOf,
} from "./forms";
export type { ContributionForm, FeeForm, FundForm, SourceForm, WizardForm } from "./forms";
export { fundHomeRow, fundsHomeRows } from "./home-queries";
export {
  firstDataOn,
  gainBars,
  gainGrain,
  homeSummary,
  isFutureYear,
  lineValue,
  staleFunds,
  valueSeries,
  valueToday,
  yearRows,
} from "./home";
export type { FundLine, GainGrain } from "./home";
export { fundsConfiguration, fundsOverview } from "./overview";
export type { Operation, ValuationRow } from "./pension/operations";
export { MAIN_COMPONENTS } from "./pension/reconcile";
export type { ComponentStatus, QuarterStatus, Status } from "./pension/reconcile";
export type { Component, Decision } from "./pension/rules";
export { clearDecision, decideDifference, replaceCompetences } from "./pension/service";
export { onTheWay } from "./period";
export type { FundPeriod, MoneyOrigin } from "./period";
export { calendarOf, hasPayrollCalendar, searchFunds } from "./queries";
export type { FundDetail } from "./queries";
export { FORECAST_RATES } from "./rules";
export type { FundForecast } from "./rules";
export {
  FundError,
  addContribution,
  addFee,
  addSource,
  createFund,
  deleteContribution,
  deleteValuation,
  fundsOnAccount,
  matchDebits,
  moveFundAccount,
  moveFundSourceAccount,
  proposeDebitMatch,
  recordValuation,
  releaseFormerAccountReferences,
  removeFee,
  removeSource,
  requireFund,
  restoreSource,
  setFundState,
  setSourceState,
  takenComponents,
  updateContribution,
  updateFee,
  updateFund,
  updateSource,
  updateValuation,
} from "./service";
export {
  ACCRUAL_PERIODS,
  INTERVAL_UNITS,
  PAYROLL_COMPONENTS,
  SOURCE_KINDS,
  competencePeriod,
  hasDueDates,
  nextDueDates,
  periodStart,
  periodsPerYear,
} from "./sources";
export type {
  AccrualPeriod,
  DebitStatus,
  DueCalendar,
  DueEntry,
  IntervalUnit,
  PayrollComponent,
  SourceKind,
} from "./sources";
export {
  bestAndWorst,
  closesPeriodBefore,
  competenceOn,
  inPeriod,
  legacyFundQuery,
  quarterInPeriod,
  readsPeriod,
  returnsTarget,
  valuationLines,
} from "./tabs";
export type { ValuationLine } from "./tabs";
export { FUND_TEMPLATES, applyTemplate } from "./templates";
export type { FundTemplate } from "./templates";
