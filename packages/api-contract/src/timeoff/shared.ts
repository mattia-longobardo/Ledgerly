// What the descriptors of time off share (rewrite plan R2, 05-refactor.md §5.5 «timeoff»; audit
// TOF-4, TOF-6, TOF-7): the vocabularies of the wire, the year of the Time off page and the pieces of
// the leave panel's writes. No route is declared here. Every length of leave is in **minutes**, as
// the domain keeps it (a payslip says hours, an allowance days); `minutesPerDay` is the bridge.
import { z } from "zod";
import { civilDate, id } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/timeoff`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
export const LEAVE_KINDS = ["vacation", "rol", "comp", "sick", "other"] as const;
/** The two kinds with an allowance, a residual and a forecast. */
export const COUNTED_KINDS = ["vacation", "rol"] as const;
/** What a payslip reports leave as, by month. */
export const PAYROLL_LEAVE_KINDS = ["vacation", "rol", "permit"] as const;
/** Which formula gave a residual (TOF-4): the payslip's RES., the allowance, or neither. */
export const RESIDUAL_BASES = ["payslip", "allowance", "unknown"] as const;
export const DAY_STATUSES = ["taken", "planned"] as const;
/**
 * Where a day came from: typed here, or read off the external calendar. Generic on the wire, not the
 * provider's name (rule M12, TOF-2): the domain's `trek` is `external` here, so R5c changes nothing.
 */
export const LEAVE_ORIGINS = ["manual", "external"] as const;
/** What the next pass of the external calendar still owes a day: `none` when the two agree. */
export const SYNC_STATES = ["none", "upsert", "delete"] as const;
export const REFUSAL_REASONS = ["weekend", "holiday"] as const;
export const DAY_FRACTIONS = [0.5, 1] as const;
/** The longest note of a day or an allowance. */
export const MAX_NOTE = 200;
/** How many days one range may span. */
export const MAX_RANGE_DAYS = 260;
export const HOLIDAY_SOURCES = ["openholidays", "nager"] as const;

/**
 * A refusal of the use cases of time off (`TimeOffError`): `invalid` (`reason` `invalid_input`,
 * `range_too_long`), `conflict` (`reason` `not_bookable`, with the refused dates in `refused`),
 * `not_found`.
 */
export const TIMEOFF_ERRORS = ["invalid", "conflict", "not_found"] as const;
/**
 * A refusal of the holiday calendars (`HolidayServiceError`, `HolidayError`): `invalid`, `not_found`,
 * `conflict` (`reason` `duplicate`, `too_many`), `unavailable` (the source did not answer).
 */
export const HOLIDAY_ERRORS = ["invalid", "not_found", "conflict", "unavailable"] as const;

export const DAY_ID = "6b7c8d9e-0f1a-4b2c-9d3e-4f5a6b7c8d9e";
export const CALENDAR_ID = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

/** A month on the wire as the domain keys it: `YYYY-MM-01`. */
const month = () => z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/);
const minutes = () => z.number().int();

export const byYear = z.object({ year: z.string().regex(/^\d{4}$/) });
export const byDay = z.object({ id: id() });
export const byDate = z.object({ date: civilDate() });
export const byCalendar = z.object({ id: id() });

/** One day of leave as the residual and the forecast weigh it. */
const dayView = z.object({ on: civilDate(), kind: z.enum(LEAVE_KINDS), fraction: z.number() });

/** The allowance of a year as stated, in days; null for a part nobody stated. */
export const allowance = z.object({
  year: z.number().int(),
  vacationDays: z.number().nullable(),
  rolDays: z.number().nullable(),
  totalDays: z.number().nullable(),
  note: z.string().nullable(),
});

/** One residual (TOF-4: one formula, `basis` says which). Null `remainingMinutes`: nobody knows. */
const residual = z.object({
  basis: z.enum(RESIDUAL_BASES),
  remainingMinutes: minutes().nullable(),
  takenMinutes: minutes(),
  plannedMinutes: minutes(),
  snapshotPeriod: month().nullable(),
  countedThrough: month().nullable(),
});

/**
 * What a card's residual is worked out from: the leave panel's «before → after» runs the same
 * `residual()` of `@ledgerly/domain/timeoff/client` over the days as they would be.
 */
const residualInput = z.object({
  snapshot: z.object({ period: month(), remainingHours: z.number() }).nullable(),
  allowanceMinutes: minutes().nullable(),
  carriedMinutes: minutes(),
  days: z.array(dayView),
  countedThrough: month().nullable(),
  minutesPerDay: minutes(),
});

const rate = z.object({ minutesPerMonth: z.number(), source: z.enum(["payslip", "allowance"]) });

/** What a forecast starts from and grows by, for the panel's «forecast on the day». */
const forecastInput = z.object({
  rate: rate.nullable(),
  opening: z.object({
    source: z.enum(["payslip", "year"]),
    minutes: minutes(),
    accruedThrough: month(),
    spentFrom: civilDate(),
  }),
  days: z.array(dayView),
  minutesPerDay: minutes(),
});

const kindView = z.object({
  residual,
  allowanceMinutes: minutes().nullable(),
  carriedMinutes: minutes(),
});

/** One row of the table: a day of ours, or a month a payslip reported. */
const leaveRow = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("day"),
    id: id(),
    on: civilDate(),
    kind: z.enum(LEAVE_KINDS),
    fraction: z.number(),
    note: z.string().nullable(),
    origin: z.enum(LEAVE_ORIGINS),
    status: z.enum(DAY_STATUSES),
    sync: z.enum(SYNC_STATES),
  }),
  z.object({
    source: z.literal("payroll"),
    id: z.string(),
    usagePeriod: month(),
    kind: z.enum(PAYROLL_LEAVE_KINDS),
    hours: z.number(),
    payrollPeriod: month(),
  }),
]);

/**
 * The Time off page of one year (`timeOffView`, TOF-7). The figures of the external calendar are in
 * `external`, apart (TOF-4): they are what the calendar last said, not the read-model's.
 */
export const timeOffYear = z.object({
  year: z.number().int(),
  today: civilDate(),
  minutesPerDay: minutes(),
  /** 0 Sunday … 6 Saturday. */
  weekStart: z.number().int().min(0).max(6),
  allowance: allowance.nullable(),
  vacation: kindView,
  rol: kindView,
  /** Twelve, one per month. */
  bars: z.array(z.object({ month: z.number().int(), takenMinutes: minutes(), plannedMinutes: minutes() })),
  rows: z.array(leaveRow),
  /** The years the picker offers, oldest first. */
  years: z.array(z.number().int()),
  /** Months whose payslip counted more leave than the days here add up to. */
  unrecorded: z.array(
    z.object({
      month: month(),
      kind: z.enum(COUNTED_KINDS),
      payrollMinutes: minutes(),
      recordedMinutes: minutes(),
      missingMinutes: minutes(),
    }),
  ),
  /** Kinds booked past what was left. */
  overdrawn: z.array(
    z.object({
      kind: z.enum(COUNTED_KINDS),
      byMinutes: minutes(),
      basis: z.enum(RESIDUAL_BASES),
      snapshotPeriod: month().nullable(),
      onDate: civilDate().nullable(),
    }),
  ),
  totals: z.object({
    takenMinutes: minutes(),
    plannedMinutes: minutes(),
    totalMinutes: minutes(),
    byKind: z.array(z.object({ kind: z.enum(LEAVE_KINDS), minutes: minutes() })),
  }),
  countedThrough: month().nullable(),
  months: z.array(
    z.object({
      month: month(),
      payroll: z.object({ vacationMinutes: minutes(), rolMinutes: minutes() }).nullable(),
      recorded: z.object({ vacationMinutes: minutes(), rolMinutes: minutes(), otherMinutes: minutes() }),
      plannedMinutes: minutes(),
      missingMinutes: minutes(),
      counted: z.boolean(),
    }),
  ),
  totalAllowanceMinutes: minutes().nullable(),
  /** Parts minus total, in days; null when there is nothing to compare. */
  allowanceMismatch: z.number().nullable(),
  /** The days of the year this person does not work, ascending. */
  holidays: z.array(civilDate()),
  residualInputs: z.object({ vacation: residualInput, rol: residualInput }),
  /** The external calendar's own figures of the year, in days, from its last pass; null without one. */
  external: z.object({ used: z.number(), remaining: z.number(), totalAvailable: z.number() }).nullable(),
  accrual: z.object({
    vacation: accrualView(),
    rol: accrualView(),
  }),
  forecastInputs: z.object({ vacation: forecastInput, rol: forecastInput }),
});

function accrualView() {
  return z.object({
    rate: rate.nullable(),
    yearEndMinutes: minutes().nullable(),
    payslipPeriod: month().nullable(),
    leads: z.boolean(),
  });
}

/** What some days held before a write: what «Undo» sends back. */
export const leaveUndo = z.object({
  dates: z.array(civilDate()).min(1).max(366),
  rows: z
    .array(
      z.object({
        on: civilDate(),
        kind: z.enum(LEAVE_KINDS),
        /** Half a day or a whole one. */
        fraction: z.number(),
        note: z.string().max(MAX_NOTE).nullable(),
      }),
    )
    .max(366 * LEAVE_KINDS.length),
});

const KIND_VIEW_EXAMPLE = {
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
  days: [{ on: "2026-08-10", kind: "vacation", fraction: 1 }],
  minutesPerDay: 480,
};

export const UNDO_EXAMPLE = {
  dates: ["2026-08-10"],
  rows: [{ on: "2026-08-10", kind: "vacation", fraction: 1, note: null }],
};

export const TIMEOFF_YEAR_EXAMPLE = {
  year: 2026,
  today: "2026-11-21",
  minutesPerDay: 480,
  weekStart: 1,
  allowance: { year: 2026, vacationDays: 22, rolDays: 4, totalDays: 26, note: null },
  vacation: KIND_VIEW_EXAMPLE,
  rol: { ...KIND_VIEW_EXAMPLE, allowanceMinutes: 1920 },
  bars: [{ month: 8, takenMinutes: 480, plannedMinutes: 0 }],
  rows: [
    {
      source: "day",
      id: DAY_ID,
      on: "2026-08-10",
      kind: "vacation",
      fraction: 1,
      note: null,
      origin: "manual",
      status: "taken",
      sync: "none",
    },
  ],
  years: [2025, 2026],
  unrecorded: [],
  overdrawn: [],
  totals: {
    takenMinutes: 480,
    plannedMinutes: 0,
    totalMinutes: 480,
    byKind: [{ kind: "vacation", minutes: 480 }],
  },
  countedThrough: null,
  months: [
    {
      month: "2026-08-01",
      payroll: null,
      recorded: { vacationMinutes: 480, rolMinutes: 0, otherMinutes: 0 },
      plannedMinutes: 0,
      missingMinutes: 0,
      counted: false,
    },
  ],
  totalAllowanceMinutes: 12480,
  allowanceMismatch: null,
  holidays: ["2026-08-15"],
  residualInputs: {
    vacation: {
      snapshot: null,
      allowanceMinutes: 10560,
      carriedMinutes: 0,
      days: [{ on: "2026-08-10", kind: "vacation", fraction: 1 }],
      countedThrough: null,
      minutesPerDay: 480,
    },
    rol: {
      snapshot: null,
      allowanceMinutes: 1920,
      carriedMinutes: 0,
      days: [],
      countedThrough: null,
      minutesPerDay: 480,
    },
  },
  external: { used: 11, remaining: 18, totalAvailable: 29 },
  accrual: {
    vacation: { rate: FORECAST_EXAMPLE.rate, yearEndMinutes: 10080, payslipPeriod: null, leads: false },
    rol: { rate: null, yearEndMinutes: null, payslipPeriod: null, leads: false },
  },
  forecastInputs: { vacation: FORECAST_EXAMPLE, rol: { ...FORECAST_EXAMPLE, rate: null, days: [] } },
};
