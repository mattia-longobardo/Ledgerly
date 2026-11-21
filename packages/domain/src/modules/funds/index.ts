// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { fundSummary, hypothesesOnly, isFundId } from "./detail";
export { assetsCost, contributionFee, periodFees } from "./fees";
export {
  contributionFormOf,
  contributionInputOf,
  feeFormOf,
  feeInputOf,
  fundInputOf,
  newContributionForm,
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
export { fundsConfiguration, fundsExport } from "./overview";
export type { Operation, ValuationRow } from "./pension/operations";
export { MAIN_COMPONENTS } from "./pension/reconcile";
export type { ComponentStatus, QuarterStatus, Status } from "./pension/reconcile";
export type { Component, Decision } from "./pension/rules";
export { competencesFromPayslips, payrollSource } from "./pension/payroll-source";
export { clearDecision, decideDifference, replaceCompetences } from "./pension/service";
export { onTheWay } from "./period";
export type { FundPeriod, MoneyOrigin } from "./period";
export { wireFunds } from "./ports";
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
export { competencePeriod, hasDueDates, nextDueDates, periodStart, periodsPerYear } from "./sources";
export type { AccrualPeriod, DebitStatus, PayrollComponent, SourceKind } from "./sources";
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
export { FUND_TEMPLATES } from "./templates";
