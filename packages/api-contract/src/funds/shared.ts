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
/** Where a line of the register came from, as its badge says it. */
export const OPERATION_ORIGINS = ["payroll", "rule", "manual", "import"] as const;
export const BRIDGE_KEYS = [
  "accrued",
  "pending",
  "enrollment",
  "voluntary",
  "other",
  "paidIn",
  "fees",
  "invested",
  "market",
  "value",
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
export const periodOut = z.object({
  kind: z.enum(["year", "all", "custom"]),
  year: z.number().int().nullable(),
  from: civilDate().nullable(),
  to: civilDate(),
  firstOn: civilDate().nullable(),
  /** The days the period covers: «all» and a period that starts before the first data start there. */
  span: z.object({ from: civilDate(), to: civilDate() }),
});

/**
 * Of whom the money is (funds-ux §5.3). A voluntary payment is yours: `voluntary` is the part of `you`
 * paid by hand, outside the payslip (the page shows `you − voluntary` and `voluntary` apart).
 */
const origin = z.object({
  you: money(),
  employer: money(),
  tfr: money(),
  other: money(),
  voluntary: money(),
});

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
  /** `valueTo` is inside the period's dates but closes the period before (decision 3 of §9). */
  valueToClosesPrevious: z.boolean(),
  /**
   * «Who paid in»: the parts of `paidIn` with money, in the page's order (`you` without the voluntary
   * payments, `employer`, `tfr`, `voluntary`, `other`), each with its share of `paidIn` (0 when nothing was paid).
   */
  originShares: z.array(
    z.object({
      key: z.enum(["you", "employer", "tfr", "voluntary", "other"]),
      amount: money(),
      share: z.number(),
    }),
  ),
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
  /** The value the fund's row and the total show: none for an archived fund in a period up to today. */
  value: money().nullable(),
  /** `end` is inside the period's dates but closes the period before. */
  endClosesPrevious: z.boolean(),
});

/** A fund as the lists name it. */
export const fundRef = z.object({
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
  funds: z.array(z.object({ fundId: id(), gain: money(), share: z.number().nullable() })),
  /** What each fund did between two readings that ends in the bar: never split over the months it spans. */
  stretches: z.array(
    z.object({
      fundId: id(),
      from: civilDate(),
      to: civilDate(),
      gain: money(),
      share: z.number().nullable(),
    }),
  ),
  /** The running total from the start of the period; null where the bar is a gap. */
  cumulative: money().nullable(),
  /** The Return view: the bar's share of the period's return, a fraction; null with no return to share. */
  share: z.number().nullable(),
  cumulativeShare: z.number().nullable(),
});

/** The gain chart: its bars, and the index of its best and worst bar (null with no bar measured). */
const gainChart = z.object({
  grain: z.enum(GAIN_GRAINS),
  bars: z.array(gainBar),
  best: z.number().int().nullable(),
  worst: z.number().int().nullable(),
});

/**
 * The value chart: one point per reading. Each fund counts with its own last reading and only the
 * money that reading could see, so the gap between the two lines is always a documented gain.
 */
const valuePoint = z.object({ on: civilDate(), value: money(), paid: money() });

/** The state of a recurring debit's running period: found (`on`), awaited, missing (`by`), or none. */
export const debitOut = z.object({
  sourceId: id(),
  state: z.enum(SOURCE_STATES),
  amount: money().nullable(),
  frequency: z.object({ count: z.number().int(), unit: z.enum(INTERVAL_UNITS) }),
  /** The day of the month it is expected on; null when the plan does not say. */
  day: z.number().int().nullable(),
  status: z.enum(["found", "awaited", "missing", "none"]),
  on: civilDate().nullable(),
  by: civilDate().nullable(),
  accountId: id().nullable(),
  accountName: z.string().nullable(),
  payeeMatch: z.string().nullable(),
});

/** One period of the payslip source still on its way to the fund, with its deadline. */
const pendingPeriod = z.object({
  year: z.number().int(),
  index: z.number().int(),
  amount: money(),
  due: civilDate().nullable(),
});

/** What a fund's sources say as of today, whatever the period (funds-ux §5.3). */
const asOfToday = {
  /** The active recurring debit; null with none. */
  debit: debitOut.nullable(),
  /** The payslip source has due dates: «on the way» has something to say. */
  hasCalendar: z.boolean(),
  onTheWay: z.object({ amount: money(), periods: z.array(pendingPeriod) }),
};

/** The Funds home (funds-ux §5-§6): what the page, `get_funds` and the export of a period show. */
export const fundsHome = z.object({
  period: periodOut,
  /** Σ of the open funds' last values up to today. */
  valueToday: money().nullable(),
  summary: measure,
  funds: z.array(
    fundRef.extend({
      line: fundLine.nullable(),
      valueToday: money().nullable(),
      stale: z.boolean(),
      /** The day of the fund's newest value, whatever the period (the «old value» link). */
      lastValueOn: civilDate().nullable(),
      ...asOfToday,
    }),
  ),
  /** «On the way» of the open funds, as of today; `awaitsPayslips`: one of them has a payslip calendar. */
  onTheWay: money(),
  awaitsPayslips: z.boolean(),
  /** The first value ever read and the first day money ever went in, across the funds. */
  firstValueOn: civilDate().nullable(),
  firstPaidOn: civilDate().nullable(),
  /** The «Accrued» note: the first fund of the period with money accrued, and when its months are due. */
  accrued: z.object({ fundId: id(), dueOn: civilDate().nullable() }).nullable(),
  /** How many funds have a value the total counts («the value of N funds»). */
  valuesSeen: z.number().int(),
  gain: gainChart,
  values: z.array(valuePoint),
  /** The years of the period, newest first, each with its measure: the table of the «All» period. */
  years: z.array(z.object({ year: z.number().int(), summary: measure })),
});

/** One reading in a period, against the reading before (the Valuations tab, funds-ux §6). */
export const valuationLine = z.object({
  on: civilDate(),
  value: money(),
  kind: z.enum(["stretch", "first", "position"]),
  fromOn: civilDate().nullable(),
  paid: money().nullable(),
  gain: money().nullable(),
  rate: z.number().nullable(),
});

/** A value recorded by hand, as its row edits it. */
export const valuationRow = z.object({
  id: id(),
  on: civilDate(),
  value: money(),
  units: z.string().nullable(),
  note: z.string().nullable(),
});

/** One operation of the register, as a person or the job wrote it. */
export const operationRow = z.object({
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
  /** A voluntary contribution's leg in the fund's account, a giroconto of origin `investments` (PERS-651). */
  legTransactionId: id().nullable(),
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
  gain: gainChart,
  values: z.array(valuePoint),
  forecast: forecast.extend({
    /** `short` for a fund fed by a recurring debit alone, `closed` otherwise. */
    layout: z.enum(["short", "closed"]),
    /** The monthly figure: the debit's plan while it runs, else the average of what went in. */
    basis: z.enum(["plan", "average"]),
  }),
  /** The day of the newest value, the one `valueToday` is. */
  valueTodayOn: civilDate().nullable(),
  /** How the payslip source counts its periods; null for a fund with no payslip source. */
  accrualPeriod: z.enum(ACCRUAL_PERIODS).nullable(),
  firstPaidOn: civilDate().nullable(),
  firstValueOn: civilDate().nullable(),
  /** Units held and the last price, for a fund with unit movements only. */
  units: z.string().nullable(),
  lastPrice: z.object({ price: z.string(), on: civilDate() }).nullable(),
  /** «From accrued to value», for a fund with a payslip source; `lines` null with no value yet. */
  bridge: z
    .object({
      lines: z.array(z.object({ key: z.enum(BRIDGE_KEYS), amount: money(), total: z.boolean() })).nullable(),
      on: civilDate().nullable(),
    })
    .nullable(),
  /** What the payslips accrued (worker, employer, TFR), for a fund with a payslip source. */
  payslipsAccrued: money().nullable(),
  ...asOfToday,
  /** The last five operations of the period that moved money, newest first. */
  recent: z.array(operationRow.extend({ gross: money(), origin: z.enum(OPERATION_ORIGINS) })),
  operationsEver: z.number().int(),
  competencesEver: z.number().int(),
  valuesEver: z.number().int(),
});
