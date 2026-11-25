// Time off · the examples of the contract (OpenAPI and the contract's own test read them).
import { DAY_ID } from "./shared";

/** The id of the example's first type of leave. */
export const TYPE_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";
const ROL_TYPE_ID = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8e";

const BALANCE_EXAMPLE = {
  residual: {
    basis: "allowance",
    remainingMinutes: 7200,
    takenMinutes: 2400,
    plannedMinutes: 960,
    snapshotPeriod: null,
    countedThrough: null,
  },
  allowanceMinutes: 10560,
  carriedMinutes: 0,
};

const FORECAST_EXAMPLE = {
  rate: { minutesPerMonth: 880, source: "allowance" },
  opening: { source: "year", minutes: 0, accruedThrough: "2025-12-01", spentFrom: "2026-01-01" },
  days: [{ on: "2026-08-10", fraction: 1, typeId: TYPE_ID, minutes: null }],
  minutesPerDay: 480,
};

export const UNDO_EXAMPLE = {
  dates: ["2026-08-10"],
  rows: [{ on: "2026-08-10", typeId: TYPE_ID, fraction: 1, minutes: null, note: null }],
};

const TYPES_EXAMPLE = [
  { id: TYPE_ID, name: "Vacation", color: "primary", unit: "half_day", hasAllowance: true, toCalendar: true },
  { id: ROL_TYPE_ID, name: "ROL", color: "warn", unit: "half_day", hasAllowance: true, toCalendar: true },
];

export const TYPE_EXAMPLE = TYPES_EXAMPLE[0];

const RESIDUAL_INPUT_EXAMPLE = {
  snapshot: null,
  allowanceMinutes: 10560,
  carriedMinutes: 0,
  days: [{ on: "2026-08-10", fraction: 1, typeId: TYPE_ID, minutes: null }],
  countedThrough: null,
  today: "2026-11-21",
  minutesPerDay: 480,
};

export const TIMEOFF_YEAR_EXAMPLE = {
  year: 2026,
  types: TYPES_EXAMPLE,
  allowances: [
    { typeId: TYPE_ID, year: 2026, days: 22, carriedDays: null },
    { typeId: ROL_TYPE_ID, year: 2026, days: 4, carriedDays: null },
  ],
  balances: [
    {
      typeId: TYPE_ID,
      ...BALANCE_EXAMPLE,
      residualInput: RESIDUAL_INPUT_EXAMPLE,
      forecastInput: FORECAST_EXAMPLE,
      accrual: { rate: FORECAST_EXAMPLE.rate, yearEndMinutes: 10080, payslipPeriod: null, leads: false },
    },
    {
      typeId: ROL_TYPE_ID,
      ...BALANCE_EXAMPLE,
      allowanceMinutes: 1920,
      residualInput: { ...RESIDUAL_INPUT_EXAMPLE, allowanceMinutes: 1920, days: [] },
      forecastInput: { ...FORECAST_EXAMPLE, rate: null, days: [] },
      accrual: { rate: null, yearEndMinutes: null, payslipPeriod: null, leads: false },
    },
  ],
  workDays: [1, 2, 3, 4, 5],
  yearStartMonth: 1,
  window: { from: "2026-01-01", to: "2026-12-31" },
  hasHolidayCalendar: true,
  unrecordedByType: [],
  overdrawnByType: [],
  today: "2026-11-21",
  minutesPerDay: 480,
  weekStart: 1,
  bars: [{ month: 8, takenMinutes: 480, plannedMinutes: 0 }],
  rows: [
    {
      source: "day",
      id: DAY_ID,
      on: "2026-08-10",
      typeId: TYPE_ID,
      fraction: 1,
      minutes: null,
      note: null,
      origin: "manual",
      status: "taken",
      sync: "none",
    },
  ],
  years: [2025, 2026],
  totals: {
    takenMinutes: 480,
    plannedMinutes: 0,
    totalMinutes: 480,
    byType: [{ typeId: TYPE_ID, minutes: 480 }],
  },
  countedThrough: null,
  months: [
    {
      month: "2026-08-01",
      payrollByType: null,
      recordedByType: [{ typeId: TYPE_ID, minutes: 480 }],
      plannedMinutes: 0,
      missingMinutes: 0,
      counted: false,
    },
  ],
  holidays: ["2026-08-15"],
  external: { used: 11, remaining: 18, totalAvailable: 29 },
};
