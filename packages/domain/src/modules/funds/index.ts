// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { fundSummary, hypothesesOnly, isFundId } from "./detail";
export { acceptDifference } from "./service/decisions";
export { assetsCost, contributionFee, periodFees } from "./fees";
export { newContributionForm } from "./forms";
export type { ContributionForm, FeeForm, FundForm, SourceForm, WizardForm } from "./forms";
export { fundHomeRow, fundsHomeRows, fundsToVerify } from "./home-queries";
export {
  aggregateCapital,
  firstDataOn,
  gainBars,
  gainGrain,
  heldValues,
  homeSummary,
  isFutureYear,
  lineValue,
  staleFunds,
  valueSeries,
  valueToday,
  yearRows,
} from "./home";
export type { FundLine, GainGrain } from "./home";
export { fundsConfiguration, fundsExport, fundsList, fundValues } from "./overview";
export type { Operation, ValuationRow } from "./pension/operations";
export { MAIN_COMPONENTS } from "./pension/reconcile";
export type { ComponentStatus, QuarterStatus, Status } from "./pension/reconcile";
export type { Component, Decision } from "./pension/rules";
export { competencesFromPayslips, payrollSource } from "./pension/payroll-source";
export { clearDecision, replaceCompetences } from "./pension/service";
export { onTheWay } from "./period";
export type { FundPeriod, MoneyOrigin } from "./period";
export { wireFunds } from "./ports";
export { calendarOf, fundsByAccount, hasPayrollCalendar, searchFunds, valuationAccountIds } from "./queries";
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
  linkAllFundLegs,
  matchDebits,
  moveFundAccount,
  moveFundSourceAccount,
  movementCandidates,
  proposeDebitMatch,
  recordValuation,
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
  quarterInPeriod,
  readsPeriod,
  valuationLines,
} from "./tabs";
export { legacyFundQuery, returnsTarget } from "./rules";
export type { ValuationLine } from "./tabs";
export {
  accruedNote,
  assetsEstimate,
  contributionDefaults,
  firstPaidOn,
  gainChart,
  firstValueOn,
  newestPoint,
  operationGross,
  operationOrigin,
  operationsIn,
  originParts,
  originShares,
  payslipLines,
  recentOperations,
  registerTotals,
  voluntaryCents,
  voluntaryIn,
} from "./queries/figures";
export type { OperationOrigin } from "./queries/figures";
export { FUND_TEMPLATES } from "./templates";
export {
  fundContributionsView,
  fundOverviewView,
  fundSettingsView,
  fundsHomeView,
  fundSetupView,
  fundValuationsView,
  viewPeriod,
} from "./queries/views";
export type { Fund, FundFee, FundSource } from "./service";
