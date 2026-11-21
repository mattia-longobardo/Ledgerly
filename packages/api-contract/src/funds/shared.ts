// What the descriptors of funds share (rewrite plan R2, 05-refactor.md §5.5 «funds»; audit FND-1,
// FND-3, FND-4): the vocabularies of the wire, the period, the measure of a period and the rows of
// the home and of a fund's tabs. No route is declared here. Amounts are decimal strings; a return is
// a fraction (0.0412 is 4,12 %), as the measure computes it; a fee's rate is a percentage, as the
// form takes it ("0.45" is 0,45 %), like the rates of interests.
import { z } from "zod";
import { civilDate, id, money } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/funds`, `shared/fees`): the contract imports
// zod only (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const FUND_STATES = ["active", "archived"] as const;
export const SOURCE_KINDS = ["payroll", "bank_debit", "manual"] as const;
export const SOURCE_STATES = ["active", "paused"] as const;
export const PAYROLL_COMPONENTS = ["worker", "employer", "tfr"] as const;
export const ACCRUAL_PERIODS = ["month", "quarter"] as const;
export const INTERVAL_UNITS = ["week", "month", "year"] as const;
export const FEE_BASES = ["one_off", "per_contribution", "periodic", "on_assets", "per_request"] as const;
export const FEE_PERIODS = ["month", "quarter", "year"] as const;
export const OPERATION_CLASSES = [
  "contribution",
  "enrollment",
  "voluntary",
  "transfer_in",
  "switch",
  "withdrawal",
  "other",
] as const;
export const OPERATION_SOURCES = ["import", "manual", "rule"] as const;
export const COMPONENTS = ["worker", "employer", "tfr", "enrollment"] as const;
export const QUARTER_STATUSES = [
  "accrued_not_due",
  "transferred",
  "to_verify",
  "present",
  "invested",
  "reconciled",
  "discrepancy",
  "incomplete",
] as const;
export const HOME_STATES = [
  "before_first",
  "measured",
  "partial",
  "running_no_value",
  "paid_no_value",
  "payslips_only",
  "quiet",
] as const;
export const LINE_STATUSES = ["measured", "no_value_in_period", "never_valued"] as const;
export const GAIN_GRAINS = ["month", "year", "stretch"] as const;

/**
 * A refusal of the funds' use cases (`FundError`): `not_found`; `invalid` (`reason` `invalid`,
 * `invalid_account`, `future_date`, `before_start`); `conflict` (`reason` `account_taken`,
 * `duplicate_name`, `archived`, `linked`, `movement_taken`, `component_taken` with the other fund's
 * name in `other`, `payroll_active`, `has_contributions`).
 */
export const FUND_ERRORS = ["invalid", "not_found", "conflict"] as const;

export const FUND_ID = "4d5e6f70-8192-4a3b-9c4d-5e6f708192a3";
export const SOURCE_ID = "6f708192-a3b4-4c5d-8e6f-708192a3b4c5";
export const FEE_ID = "708192a3-b4c5-4d6e-9f70-8192a3b4c5d6";
export const VALUATION_ID = "8192a3b4-c5d6-4e7f-8091-92a3b4c5d6e7";
export const OPERATION_ID = "92a3b4c5-d6e7-4f80-9102-a3b4c5d6e7f8";
export const ACCOUNT_ID = "a3b4c5d6-e7f8-4091-a213-b4c5d6e7f809";
export const TRANSACTION_ID = "b4c5d6e7-f809-4102-b324-c5d6e7f8091a";

export const byFund = z.object({ id: id() });

/**
 * The period of the home and of a fund's tabs (funds-ux §6), as the pages read it from the address:
 * `period` = `all` | `<year>` | `custom` (with `from` and `to`); none is the year running. A year
 * after today's is `invalid`: the page sends it back to the year running.
 */
export const periodQuery = z.object({
  period: z
    .string()
    .regex(/^(all|custom|\d{4})$/)
    .optional(),
  from: civilDate().optional(),
  to: civilDate().optional(),
});

/** The period the server measured: its days, and the first day there is data for. */
const periodOut = z.object({
  kind: z.enum(["year", "all", "custom"]),
  year: z.number().int().nullable(),
  from: civilDate().nullable(),
  to: civilDate(),
  firstOn: civilDate().nullable(),
});

/** Of whom the money is (funds-ux §5.3). A voluntary payment is yours. */
const origin = z.object({ you: money(), employer: money(), tfr: money(), other: money() });

/** The money-weighted return over 365 days or more; `none`/`multiple` when no single rate exists. */
const xirr = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("ok"), rate: z.number() }),
    z.object({ status: z.literal("none") }),
    z.object({ status: z.literal("multiple") }),
  ])
  .nullable();

/** A documented value: the day it was read and the amount. */
const point = z.object({ on: civilDate(), value: money() });

/**
 * The measure of a period (funds-ux §5.2-§5.3), for the portfolio or one fund: the same numbers the
 * pages print. `gain` and `market` are null, never zero, when no fund can be measured.
 */
const measure = z.object({
  state: z.enum(HOME_STATES),
  gain: money().nullable(),
  market: money().nullable(),
  fees: money(),
  feesPartial: z.boolean(),
  paidIn: money(),
  origin,
  /** Modified Dietz, a fraction; null under the capital threshold. */
  rate: z.number().nullable(),
  xirr,
  /** Σ of the last values the period can see, with the span of their dates. */
  value: money().nullable(),
  valueFrom: civilDate().nullable(),
  valueTo: civilDate().nullable(),
  /** Money of the period after its last value: no value has seen it yet. */
  notInValue: money(),
  /** What the payslips accrued and the fund has not received yet. */
  accrued: money(),
});

/** One fund in a period: its own measure, and why it has none. */
const fundLine = z.object({
  fundId: id(),
  status: z.enum(LINE_STATUSES),
  start: point.nullable(),
  end: point.nullable(),
  gain: money().nullable(),
  market: money().nullable(),
  fees: money().nullable(),
  feesPartial: z.boolean(),
  rate: z.number().nullable(),
  xirr,
  paidIn: money(),
  origin,
  notInValue: money(),
  accrued: money(),
});

/** A fund as the lists name it. */
const fundRef = z.object({
  id: id(),
  name: z.string(),
  provider: z.string().nullable(),
  compartment: z.string().nullable(),
  code: z.string().nullable(),
  startOn: civilDate(),
  state: z.enum(FUND_STATES),
  /** The currency of the account that holds the value. */
  currency: z.string(),
  /** The colour of the fund's account; null: the palette's colour by the fund's place in the list. */
  color: z.string().nullable(),
  accountId: id(),
  accountName: z.string(),
});

/** The bars of the gain chart: one per month, year or stretch between two values. */
const gainBar = z.object({
  from: civilDate(),
  to: civilDate(),
  /** Null when no fund has a reading in the bar: a gap, never a zero. */
  total: money().nullable(),
  /** The gain of each fund in the bar; a fund with no reading there is absent. */
  funds: z.array(z.object({ fundId: id(), gain: money() })),
});

/**
 * The value chart: one point per reading. Each fund counts with its own last reading and only the
 * money that reading could see, so the gap between the two lines is always a documented gain.
 */
const valuePoint = z.object({ on: civilDate(), value: money(), paid: money() });

/** The Funds home (funds-ux §5-§6): what the page, `get_funds` and the export of a period show. */
export const fundsHome = z.object({
  period: periodOut,
  /** Σ of the open funds' last values up to today. */
  valueToday: money().nullable(),
  summary: measure,
  funds: z.array(
    fundRef.extend({ line: fundLine.nullable(), valueToday: money().nullable(), stale: z.boolean() }),
  ),
  gain: z.object({ grain: z.enum(GAIN_GRAINS), bars: z.array(gainBar) }),
  values: z.array(valuePoint),
  /** The years of the period, newest first, each with its measure: the table of the «All» period. */
  years: z.array(z.object({ year: z.number().int(), summary: measure })),
});

/** One reading in a period, against the reading before (the Valuations tab, funds-ux §6). */
const valuationLine = z.object({
  on: civilDate(),
  value: money(),
  kind: z.enum(["stretch", "first", "position"]),
  fromOn: civilDate().nullable(),
  paid: money().nullable(),
  gain: money().nullable(),
  rate: z.number().nullable(),
});

/** A value recorded by hand, as its row edits it. */
const valuationRow = z.object({
  id: id(),
  on: civilDate(),
  value: money(),
  units: z.string().nullable(),
  note: z.string().nullable(),
});

/** The projection (funds-ux §7): the value in 1, 3, 5 and 10 years at each hypothesis rate. */
const forecast = z.object({
  monthly: money(),
  /** The hypothesis rates, fractions. The fund's own rate is not one of them (decision 2 of §9). */
  rates: z.array(z.number()),
  rows: z.array(
    z.object({
      years: z.number().int(),
      /** What will have been paid in, if the present rhythm holds. */
      paidIn: money(),
      /** The value at each rate; null with no value to grow. */
      values: z.array(money().nullable()),
    }),
  ),
});

/** A fund's Overview tab: the fund, its measure in the period, its charts and its projection. */
export const fundOverview = z.object({
  fund: fundRef,
  period: periodOut,
  /** The period ends before the fund's first data, and the first value is a position, not a gain. */
  beforeFirst: z.boolean(),
  summary: measure,
  line: fundLine,
  valueToday: money().nullable(),
  /** The fund's value is older than its latest operation (GC §11.8). */
  valueOlderThanOperations: z.boolean(),
  gain: z.object({ grain: z.enum(GAIN_GRAINS), bars: z.array(gainBar) }),
  values: z.array(valuePoint),
  forecast,
});

/** A fund's Valuations tab: the lines of the period, the best and worst stretch, the recorded values. */
export const fundValuations = z.object({
  fundId: id(),
  period: periodOut,
  lines: z.array(valuationLine),
  best: valuationLine.nullable(),
  worst: valuationLine.nullable(),
  recorded: z.array(valuationRow),
});

/** One operation of the register, as a person or the job wrote it. */
const operationRow = z.object({
  id: id(),
  on: civilDate(),
  classification: z.enum(OPERATION_CLASSES),
  source: z.enum(OPERATION_SOURCES),
  worker: money(),
  employer: money(),
  tfr: money(),
  other: money(),
  /** Null while nobody knows the fee. */
  fee: money().nullable(),
  net: money(),
  units: z.string().nullable(),
  /** The period the operation is for, counted as the payslip source counts it. */
  competence: z.object({ year: z.number().int(), index: z.number().int() }).nullable(),
  transactionId: id().nullable(),
  note: z.string().nullable(),
});

/** One component of a period against the payslips (GC §9-§11). */
const componentStatus = z.object({
  component: z.enum(COMPONENTS),
  accrued: money().nullable(),
  credited: money().nullable(),
  difference: money().nullable(),
  status: z.enum(QUARTER_STATUSES),
  decision: z.object({ note: z.string(), difference: money() }).nullable(),
});

/** One period of the payslip source: accrued against credited, with its deadline. */
const quarterStatus = z.object({
  year: z.number().int(),
  /** A quarter, or a month for a source that accrues by month. */
  index: z.number().int(),
  due: civilDate().nullable(),
  toleranceUntil: civilDate().nullable(),
  status: z.enum(QUARTER_STATUSES),
  reason: z.enum(["missing_payslip", "stale_export"]).nullable(),
  components: z.array(componentStatus),
  missingMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)),
  fees: money(),
  net: money(),
  /** The payslips whose competences make the period, for the link to their review. */
  payslips: z.array(z.object({ payslipId: id(), documentId: id().nullable() })),
});

/** A fund's Contributions tab: the register, the periods of the payslip source and the accrued months. */
export const fundContributions = z.object({
  fundId: id(),
  period: periodOut,
  operations: z.array(operationRow),
  /** Null for a fund with no payslip source. */
  payroll: z
    .object({
      accrualPeriod: z.enum(ACCRUAL_PERIODS),
      components: z.array(z.enum(PAYROLL_COMPONENTS)),
      /** The source has due dates: the periods and «on the way» are drawn. */
      hasCalendar: z.boolean(),
      periods: z.array(quarterStatus),
      onTheWay: money(),
    })
    .nullable(),
  accrued: z.array(z.object({ on: civilDate(), amount: money(), dueOn: civilDate().nullable() })),
  /** The active recurring debit's state, when the fund has one. */
  debit: z
    .object({
      sourceId: id(),
      /** The running period's debit: found (on its day), awaited, or missing (by a day). */
      status: z.enum(["found", "awaited", "missing", "none"]),
      on: civilDate().nullable(),
      amount: money().nullable(),
      accountName: z.string().nullable(),
    })
    .nullable(),
});

/** A source of contributions, as its form edits it. */
export const sourceRow = z.object({
  id: id(),
  kind: z.enum(SOURCE_KINDS),
  state: z.enum(SOURCE_STATES),
  components: z.array(z.enum(PAYROLL_COMPONENTS)).nullable(),
  accrualPeriod: z.enum(ACCRUAL_PERIODS).nullable(),
  employer: z.string().nullable(),
  due: z.object({ day: z.number().int(), offsetMonths: z.number().int() }).nullable(),
  /** The explicit due dates a source keeps (`keepDueEntries`): opaque, handed back as they came. */
  dueEntries: z.unknown(),
  toleranceDays: z.number().int().nullable(),
  amount: money().nullable(),
  frequency: z.object({ count: z.number().int(), unit: z.enum(INTERVAL_UNITS) }).nullable(),
  debitDay: z.number().int().nullable(),
  accountId: id().nullable(),
  accountName: z.string().nullable(),
  payeeMatch: z.string().nullable(),
  validFrom: civilDate().nullable(),
  validTo: civilDate().nullable(),
  note: z.string().nullable(),
  /** How many contributions it has: one with contributions is paused, never removed. */
  contributions: z.number().int(),
});

/** A fee, as its form edits it. */
export const feeRow = z.object({
  id: id(),
  label: z.string(),
  basis: z.enum(FEE_BASES),
  amount: money().nullable(),
  /** A percentage ("0.45" is 0,45 %). */
  rate: z.string().nullable(),
  period: z.enum(FEE_PERIODS).nullable(),
  sourceId: id().nullable(),
  component: z.enum(PAYROLL_COMPONENTS).nullable(),
  validFrom: civilDate().nullable(),
  validTo: civilDate().nullable(),
  note: z.string().nullable(),
});

/** A fund's Settings tab: the fund, its sources and fees, the codes of the payslip, what is taken. */
export const fundSettings = z.object({
  fund: fundRef,
  sources: z.array(sourceRow),
  fees: z.array(feeRow),
  /** The payslip codes behind each component, for Settings to show them. */
  codes: z.record(z.string(), z.array(z.string())),
  /** The components another fund's payslip source already takes, with that fund's name. */
  taken: z.array(z.object({ component: z.enum(PAYROLL_COMPONENTS), fund: z.string() })),
});
