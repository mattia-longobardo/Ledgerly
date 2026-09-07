import { z } from "@hono/zod-openapi";

/**
 * Wire shapes for the Time off module.
 *
 * Every quantity is a two-decimal STRING, exactly as `domain/units.ts`
 * produces it and as Postgres hands `numeric` back — never a JSON number.
 * `null` means "no figure on file" and is rendered as "—" by callers; it is
 * never flattened to `"0.00"`.
 *
 * `ErrorResponseSchema` is NOT declared here: it is imported from
 * `@/modules/accounts/api/schemas` in `routes.ts`, the app's one existing
 * `.openapi("ErrorResponse")` registration.
 */

export const TimeoffCodeSchema = z
  .enum(["vacation", "comp", "permits", "sick", "other"])
  .openapi("TimeoffCode");

/** Trek's whole fraction domain: a day is booked whole or half, nothing between. */
export const TimeoffFractionSchema = z.enum(["1.00", "0.50"]).openapi("TimeoffFraction");

export const TimeoffTypeSchema = z
  .object({
    id: z.string().uuid(),
    code: TimeoffCodeSchema,
    label: z.string(),
    unit: z.enum(["hours", "days"]),
    hoursPerDay: z.string(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("TimeoffType");

export const TimeoffTypeListResponseSchema = z
  .object({ items: z.array(TimeoffTypeSchema) })
  .openapi("TimeoffTypeListResponse");

export const TimeoffEventSchema = z
  .object({
    id: z.string().uuid(),
    date: z.string(),
    fraction: z.string(),
    typeCode: z.string(),
    status: z.string(),
    origin: z.string(),
    pendingOp: z.string(),
    note: z.string().nullable(),
    syncedAt: z.string().nullable(),
    trekEntryId: z.number().nullable(),
    version: z.number(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .openapi("TimeoffEvent");

export const TimeoffEventListResponseSchema = z
  .object({ items: z.array(TimeoffEventSchema) })
  .openapi("TimeoffEventListResponse");

export const TimeoffBalanceSchema = z
  .object({
    id: z.string().uuid(),
    typeId: z.string().uuid(),
    asOf: z.string(),
    accrued: z.string().nullable(),
    used: z.string().nullable(),
    remaining: z.string().nullable(),
    pending: z.string().nullable(),
    unit: z.enum(["hours", "days"]),
    source: z.enum(["payroll", "manual"]),
    createdAt: z.string(),
  })
  .openapi("TimeoffBalance");

export const TimeoffBalanceListResponseSchema = z
  .object({ items: z.array(TimeoffBalanceSchema) })
  .openapi("TimeoffBalanceListResponse");

/**
 * The latest balance per type, joined to the type it belongs to. Every figure
 * is nullable: nothing has necessarily ever written a balance for a type.
 */
export const TimeoffBalanceViewSchema = z
  .object({
    type: TimeoffTypeSchema,
    asOf: z.string().nullable(),
    remainingHours: z.string().nullable(),
    remainingDays: z.string().nullable(),
    usedYtdHours: z.string().nullable(),
    source: z.enum(["payroll", "manual"]).nullable(),
  })
  .openapi("TimeoffBalanceView");

export const TimeoffWorkspaceDaySchema = z
  .object({
    fraction: z.string(),
    typeCode: TimeoffCodeSchema,
    note: z.string().nullable(),
    status: z.string(),
    pendingOp: z.string(),
  })
  .openapi("TimeoffWorkspaceDay");

export const TimeoffDayDetailSchema = z
  .object({
    date: z.string(),
    event: TimeoffEventSchema.nullable(),
    status: z.enum(["planned", "taken", "cancelled"]).nullable(),
  })
  .openapi("TimeoffDayDetail");

/** Trek's own figures for the year, as last cached. Numbers, because Trek reports them as numbers. */
export const TrekYearStatsSchema = z
  .object({
    year: z.number(),
    personName: z.string(),
    vacationDays: z.number(),
    carriedOver: z.number(),
    totalAvailable: z.number(),
    used: z.number(),
    remaining: z.number(),
    compUsed: z.number(),
    windowStart: z.string(),
    windowEnd: z.string(),
  })
  .openapi("TrekYearStats");

export const TimeoffWorkspaceSchema = z
  .object({
    year: z.number(),
    today: z.string(),
    types: z.array(TimeoffTypeSchema),
    balances: z.array(TimeoffBalanceViewSchema),
    byDate: z.record(z.string(), TimeoffWorkspaceDaySchema),
    selected: TimeoffDayDetailSchema.nullable(),
    upcoming: z.array(TimeoffEventSchema),
    plannedDaysYtd: z.string(),
    pendingCount: z.number(),
    trekConnected: z.boolean(),
    cachedStats: z
      .object({ stats: TrekYearStatsSchema, fetchedAt: z.string() })
      .nullable(),
  })
  .openapi("TimeoffWorkspace");

const YEAR = z.coerce.number().int().min(2000).max(2100);
const ISO_DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date.");

export const TimeoffWorkspaceQuerySchema = z.object({
  year: YEAR.optional(),
  date: ISO_DATE.optional(),
});

export const TimeoffEventsQuerySchema = z.object({ from: ISO_DATE, to: ISO_DATE });

export const TimeoffBalancesQuerySchema = z.object({ year: YEAR.optional() });

export const TimeoffDateParamSchema = z.object({ date: ISO_DATE });

export const SetTimeoffEventRequestSchema = z.object({
  fraction: TimeoffFractionSchema,
  typeCode: TimeoffCodeSchema,
  note: z.string().max(200).nullish(),
});
