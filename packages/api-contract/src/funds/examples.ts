// The examples of the funds' descriptors, checked against their schemas by the gate.
import { ACCOUNT_ID, FEE_ID, FUND_ID, SOURCE_ID } from "./shared";

const ORIGIN_EXAMPLE = { you: "240.00", employer: "180.00", tfr: "630.00", other: "0.00" };

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
} as const;

export const GAIN_EXAMPLE = {
  grain: "month",
  bars: [{ from: "2026-09-01", to: "2026-09-30", funds: [{ fundId: FUND_ID, gain: "48.10" }] }],
} as const;

export const VALUES_EXAMPLE = [
  { on: "2026-10-01", value: "12450.00", funds: [{ fundId: FUND_ID, value: "12450.00" }] },
] as const;

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
