// The examples of the funds' descriptors, checked against their schemas by the gate.
import { ACCOUNT_ID, FEE_ID, FUND_ID, SOURCE_ID } from "./shared";

const ORIGIN_EXAMPLE = { you: "240.00", employer: "180.00", tfr: "630.00", other: "0.00", voluntary: "0.00" };

export const MEASURE_EXAMPLE = {
  state: "measured",
  gain: "412.30",
  market: "421.30",
  fees: "9.00",
  feesPartial: false,
  paidIn: "1050.00",
  origin: ORIGIN_EXAMPLE,
  rate: 0.0412,
  xirr: null,
  value: "12450.00",
  valueFrom: "2026-10-01",
  valueTo: "2026-10-01",
  notInValue: "0.00",
  accrued: "350.00",
} as const;

export const PERIOD_EXAMPLE = {
  kind: "year",
  year: 2026,
  from: "2026-01-01",
  to: "2026-11-21",
  firstOn: "2024-01-20",
} as const;

export const FUND_REF_EXAMPLE = {
  id: FUND_ID,
  name: "Fondo Alfa",
  provider: "Example Pension",
  compartment: "Balanced",
  code: null,
  startOn: "2024-01-01",
  state: "active",
  currency: "EUR",
  color: "#4f7cac",
  accountId: ACCOUNT_ID,
  accountName: "Fondo Alfa",
} as const;

export const LINE_EXAMPLE = {
  fundId: FUND_ID,
  status: "measured",
  start: { on: "2026-01-01", value: "10988.00" },
  end: { on: "2026-10-01", value: "12450.00" },
  gain: "412.30",
  market: "421.30",
  fees: "9.00",
  feesPartial: false,
  rate: 0.0412,
  xirr: null,
  paidIn: "1050.00",
  origin: ORIGIN_EXAMPLE,
  notInValue: "0.00",
  accrued: "350.00",
  value: "12450.00",
} as const;

export const GAIN_EXAMPLE = {
  grain: "month",
  bars: [
    {
      from: "2026-09-01",
      to: "2026-09-30",
      total: "48.10",
      funds: [{ fundId: FUND_ID, gain: "48.10", share: 0.0048 }],
      stretches: [{ fundId: FUND_ID, from: "2026-08-31", to: "2026-09-30", gain: "48.10" }],
      cumulative: "48.10",
      share: 0.0048,
      cumulativeShare: 0.0048,
    },
  ],
  best: 0,
  worst: 0,
} as const;

export const VALUES_EXAMPLE = [{ on: "2026-10-01", value: "12450.00", paid: "11050.00" }] as const;

export const SOURCE_EXAMPLE = {
  id: SOURCE_ID,
  kind: "payroll",
  state: "active",
  components: ["worker", "employer", "tfr"],
  accrualPeriod: "quarter",
  employer: "Example Employer",
  due: { day: 20, offsetMonths: 1 },
  dueEntries: null,
  toleranceDays: 15,
  amount: null,
  frequency: null,
  debitDay: null,
  accountId: null,
  accountName: null,
  payeeMatch: null,
  validFrom: null,
  validTo: null,
  note: null,
  contributions: 4,
} as const;

export const FEE_EXAMPLE = {
  id: FEE_ID,
  label: "Contribution fee",
  basis: "per_contribution",
  amount: "3.00",
  rate: null,
  period: null,
  sourceId: SOURCE_ID,
  component: null,
  validFrom: null,
  validTo: null,
  note: null,
} as const;

const DEBIT_EXAMPLE = {
  sourceId: SOURCE_ID,
  state: "active",
  amount: "100.00",
  frequency: { count: 1, unit: "month" },
  day: 5,
  status: "found",
  on: "2026-11-05",
  by: null,
  accountId: ACCOUNT_ID,
  accountName: "Conto corrente",
  payeeMatch: "FONDO ALFA",
} as const;

/** What a fund's sources say as of today, in the home's rows and in the Overview. */
const AS_OF_TODAY_EXAMPLE = {
  debit: DEBIT_EXAMPLE,
  hasCalendar: true,
  onTheWay: { amount: "350.00", periods: [{ year: 2026, index: 4, amount: "350.00", due: "2027-01-20" }] },
} as const;

export const HOME_FUND_EXAMPLE = {
  ...FUND_REF_EXAMPLE,
  line: LINE_EXAMPLE,
  valueToday: "12450.00",
  stale: false,
  lastValueOn: "2026-10-01",
  ...AS_OF_TODAY_EXAMPLE,
} as const;

/** The Overview's fields beside the measure and the charts. */
export const OVERVIEW_EXAMPLE = {
  valueTodayOn: "2026-10-01",
  firstPaidOn: "2024-01-20",
  firstValueOn: "2024-03-31",
  units: null,
  lastPrice: null,
  bridge: {
    lines: [
      { key: "accrued", amount: "11400.00", total: false },
      { key: "value", amount: "12450.00", total: true },
    ],
    on: "2026-10-01",
  },
  payslipsAccrued: "11400.00",
  ...AS_OF_TODAY_EXAMPLE,
  recent: [],
  operationsEver: 12,
  competencesEver: 30,
  valuesEver: 8,
} as const;

/** The Contributions tab's fields beside the register and the periods. */
export const CONTRIBUTIONS_EXAMPLE = {
  fund: FUND_REF_EXAMPLE,
  totals: {
    worker: "240.00",
    employer: "180.00",
    tfr: "630.00",
    voluntary: "0.00",
    other: "0.00",
    fees: "9.00",
    net: "1041.00",
  },
  operationsEver: 12,
  fedBySources: true,
  payslips: [],
  payslipTotals: { worker: "0.00", employer: "0.00", tfr: "0.00", total: "0.00" },
  debits: [DEBIT_EXAMPLE],
  setup: {
    defaultKind: "voluntary",
    defaultFees: { voluntary: "1.00", payroll: "0.00" },
    periods: [{ year: 2026, index: 4 }],
    pendingPeriod: null,
  },
} as const;
