// What the descriptors of time off share (rewrite plan R2, 05-refactor.md §5.5 «timeoff»; audit
// TOF-4, TOF-6, TOF-7): the vocabularies of the wire, the year of the Time off page and the pieces of
// the leave panel's writes. No route is declared here. Every length of leave is in **minutes**, as
// the domain keeps it (a payslip says hours, an allowance days); `minutesPerDay` is the bridge.
import { z } from "zod";
import { civilDate, id } from "../primitives";

// The vocabularies are the domain's (`@ledgerly/domain/timeoff`): the contract imports zod only
// (10-modularity.md §10.2), so `tools/contract.test.ts` holds the lists equal.
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
const dayView = z.object({
  on: civilDate(),
  fraction: z.number(),
  /** The id of the day's type (R5g). */
  typeId: z.string(),
  /** The length of a row of a type counted in hours; null for the others. */
  minutes: minutes().nullable(),
});

/** What one row of a type is (R5g). */
export const LEAVE_UNITS = ["day", "half_day", "hours"] as const;
/** The colours a type may take: tokens of the design system. */
export const LEAVE_COLORS = ["primary", "warn", "accent", "neg", "faint", "pos", "muted"] as const;

/** A type of leave of the person (R5g): data, not a name of the code. */
export const leaveType = z.object({
  id: id(),
  name: z.string(),
  color: z.enum(LEAVE_COLORS),
  unit: z.enum(LEAVE_UNITS),
  hasAllowance: z.boolean(),
  toCalendar: z.boolean(),
});

/** What a year grants of one type, in days, and the carry-over stated where no payslip prints it. */
export const typeAllowance = z.object({
  typeId: id(),
  year: z.number().int(),
  days: z.number().nullable(),
  carriedDays: z.number().nullable(),
});

const typeMinutes = z.object({ typeId: z.string(), minutes: minutes() });

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
  /** In a year with no payslip, a day before it is taken (R5g). */
  today: civilDate().nullable(),
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

/** One row of the table: a day of ours, or a month a payslip reported. */
const leaveRow = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("day"),
    id: id(),
    on: civilDate(),
    typeId: z.string(),
    fraction: z.number(),
    minutes: minutes().nullable(),
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
    /** The type the use counts against; null when no type of the person's has its balance. */
    typeId: z.string().nullable(),
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
  /** The person's types of leave, in their order (R5g). */
  types: z.array(leaveType),
  /** What the person stated for the year, by type (R5g). */
  allowances: z.array(typeAllowance),
  /** The residual and the forecast of each type with an allowance, in the types' order (R5g). */
  balances: z.array(
    z.object({
      typeId: id(),
      residual,
      allowanceMinutes: minutes().nullable(),
      carriedMinutes: minutes(),
      residualInput,
      forecastInput,
      accrual: accrualView(),
    }),
  ),
  /** The days of the week the person works, 0 Sunday … 6 Saturday (R5g). */
  workDays: z.array(z.number().int().min(0).max(6)),
  /** The month the leave year starts in, and its days (R5g). */
  yearStartMonth: z.number().int().min(1).max(12),
  window: z.object({ from: civilDate(), to: civilDate() }),
  /** Without a calendar of holidays only the working week is known (R5g). */
  hasHolidayCalendar: z.boolean(),
  unrecordedByType: z.array(
    z.object({
      month: month(),
      typeId: id(),
      payrollMinutes: minutes(),
      recordedMinutes: minutes(),
      missingMinutes: minutes(),
    }),
  ),
  overdrawnByType: z.array(
    z.object({
      typeId: id(),
      byMinutes: minutes(),
      basis: z.enum(RESIDUAL_BASES),
      snapshotPeriod: month().nullable(),
      onDate: civilDate().nullable(),
    }),
  ),
  today: civilDate(),
  minutesPerDay: minutes(),
  /** 0 Sunday … 6 Saturday. */
  weekStart: z.number().int().min(0).max(6),
  /** Twelve, one per month. */
  bars: z.array(z.object({ month: z.number().int(), takenMinutes: minutes(), plannedMinutes: minutes() })),
  rows: z.array(leaveRow),
  /** The years the picker offers, oldest first. */
  years: z.array(z.number().int()),
  totals: z.object({
    takenMinutes: minutes(),
    plannedMinutes: minutes(),
    totalMinutes: minutes(),
    byType: z.array(typeMinutes),
  }),
  countedThrough: month().nullable(),
  months: z.array(
    z.object({
      month: month(),
      /** What the payslips counted, per type (R5g); null when no payslip covers the month. */
      payrollByType: z.array(typeMinutes).nullable(),
      /** What is recorded here, per type with something (R5g). */
      recordedByType: z.array(typeMinutes),
      plannedMinutes: minutes(),
      missingMinutes: minutes(),
      counted: z.boolean(),
    }),
  ),
  /** The days of the year this person does not work, ascending. */
  holidays: z.array(civilDate()),
  /** The external calendar's own figures of the year, in days, from its last pass; null without one. */
  external: z.object({ used: z.number(), remaining: z.number(), totalAvailable: z.number() }).nullable(),
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
        typeId: id(),
        fraction: z.number(),
        minutes: minutes().nullish(),
        note: z.string().max(MAX_NOTE).nullable(),
      }),
    )
    .max(366 * 8),
});
