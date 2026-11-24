// The types of leave, the working week, the days off of the year and the allowances by type
// (rewrite plan R5g, E6): what a person states once and every rule of time off reads.
import { and, asc, count, eq, max } from "drizzle-orm";
import { getSavedPreferences } from "../../users/service";
import { holidaysOf } from "../../../platform/holidays/service";
import type { Ctx } from "../../../platform/context";
import type { CivilDate } from "../../../shared/dates";
import { countryRules, hasPack } from "../../../shared/country";
import { getDb } from "../../../platform/db/client";
import { userScoped } from "../../../platform/db/scope";
import {
  type AllowanceInput,
  type LeaveSettingsInput,
  type LeaveType,
  type LeaveTypeInput,
  type RestDayInput,
  allowanceInputSchema,
  DEFAULT_WORK_DAYS,
  leaveSettingsInputSchema,
  leaveTypeInputSchema,
  restDayInputSchema,
} from "../rules";
import { leaveAllowances, leaveDays, leaveRestDays, leaveSettings, leaveTypes } from "../schema";
import { legacyAllowanceField, timeoffAllowances } from "../schema/legacy";
import { TimeOffError } from "./errors";

type TypeRow = typeof leaveTypes.$inferSelect;

/** A type as the screens and the API read it: the rules' view and the old kind it still writes. */
export interface LeaveTypeView extends LeaveType {
  legacyKind: string | null;
}

const asType = (row: TypeRow): LeaveTypeView => ({
  id: row.id,
  name: row.name,
  color: row.color,
  unit: row.unit,
  hasAllowance: row.hasAllowance,
  toCalendar: row.toCalendar,
  balanceKey: row.balanceKey,
  calendarKind: row.calendarKind,
  legacyKind: row.legacyKind,
});

/**
 * The first time a person reaches time off: the row of their settings, and the types of their
 * country's pack, in their language. Only once — the settings' row says it happened — so a person
 * who removed every type is not given them back.
 */
async function startTimeOff(ctx: Pick<Ctx, "userId">): Promise<void> {
  const preferences = await getSavedPreferences(ctx);
  await getDb().transaction(async (tx) => {
    const created = await tx
      .insert(leaveSettings)
      .values(userScoped(ctx).stamp({ workDays: [...DEFAULT_WORK_DAYS] }))
      .onConflictDoNothing()
      .returning({ userId: leaveSettings.userId });
    if (created.length === 0 || !hasPack(preferences.country)) return;
    const pack = countryRules(preferences.country).leaveTypes;
    if (pack.length === 0) return;
    await tx.insert(leaveTypes).values(
      pack.map((type, position) =>
        userScoped(ctx).stamp({
          name: type.names[preferences.locale],
          color: type.color,
          unit: type.unit,
          hasAllowance: type.hasAllowance,
          toCalendar: type.toCalendar,
          balanceKey: type.balanceKey,
          calendarKind: type.calendarKind,
          position,
        }),
      ),
    );
  });
}

/** The settings' row and the types, in one read: no row means the person never reached time off. */
async function typesAndSettings(ctx: Pick<Ctx, "userId">) {
  const rows = await getDb()
    .select({ settings: leaveSettings, type: leaveTypes })
    .from(leaveSettings)
    .leftJoin(leaveTypes, eq(leaveTypes.userId, leaveSettings.userId))
    .where(userScoped(ctx).owns(leaveSettings))
    .orderBy(asc(leaveTypes.position), asc(leaveTypes.id));
  if (rows.length === 0) return null;
  const { settings } = rows[0];
  return {
    settings: { yearStartMonth: settings.yearStartMonth, workDays: [...settings.workDays].sort() },
    types: rows.flatMap((row) => (row.type === null ? [] : [asType(row.type)])),
  };
}

/** The types and the settings; the pack's types the first time. */
async function startedTypes(ctx: Pick<Ctx, "userId">) {
  const read = await typesAndSettings(ctx);
  if (read !== null) return read;
  await startTimeOff(ctx);
  return (await typesAndSettings(ctx)) as NonNullable<Awaited<ReturnType<typeof typesAndSettings>>>;
}

/** The person's types, in their order; the pack's ones the first time. */
export async function listLeaveTypes(ctx: Pick<Ctx, "userId">): Promise<LeaveTypeView[]> {
  return (await startedTypes(ctx)).types;
}

/** One of the person's types, or `not_found`. */
async function leaveTypeOf(ctx: Pick<Ctx, "userId">, id: string): Promise<LeaveTypeView> {
  const found = (await listLeaveTypes(ctx)).find((type) => type.id === id);
  if (!found) throw new TimeOffError("not_found");
  return found;
}

function isUniqueViolation(error: unknown): boolean {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  return (error as { code?: string } | null)?.code === "23505" || cause?.code === "23505";
}

/** Adds a type at the end of the list, or changes one; a name the person already uses is `conflict`. */
export async function saveLeaveType(
  ctx: Pick<Ctx, "userId">,
  id: string | null,
  input: LeaveTypeInput,
): Promise<LeaveTypeView> {
  const parsed = leaveTypeInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  await listLeaveTypes(ctx);
  try {
    if (id === null) {
      const [last] = await getDb()
        .select({ position: max(leaveTypes.position) })
        .from(leaveTypes)
        .where(userScoped(ctx).owns(leaveTypes));
      const [row] = await getDb()
        .insert(leaveTypes)
        .values(userScoped(ctx).stamp({ ...parsed.data, position: (last?.position ?? -1) + 1 }))
        .returning();
      return asType(row);
    }
    const [row] = await getDb()
      .update(leaveTypes)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(leaveTypes.id, id), userScoped(ctx).owns(leaveTypes)))
      .returning();
    if (!row) throw new TimeOffError("not_found");
    return asType(row);
  } catch (error) {
    if (isUniqueViolation(error)) throw new TimeOffError("conflict");
    throw error;
  }
}

/** Removes a type nobody booked a day of; one with days is `in_use` (its days would lose their type). */
export async function deleteLeaveType(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  await leaveTypeOf(ctx, id);
  const [used] = await getDb()
    .select({ days: count() })
    .from(leaveDays)
    .where(and(userScoped(ctx).owns(leaveDays), eq(leaveDays.typeId, id)));
  if ((used?.days ?? 0) > 0) throw new TimeOffError("in_use");
  await getDb()
    .delete(leaveTypes)
    .where(and(eq(leaveTypes.id, id), userScoped(ctx).owns(leaveTypes)));
}

/* The working week and the leave year */

export interface LeaveSettings {
  yearStartMonth: number;
  workDays: number[];
}

export async function leaveSettingsOf(ctx: Pick<Ctx, "userId">): Promise<LeaveSettings> {
  const [row] = await getDb().select().from(leaveSettings).where(userScoped(ctx).owns(leaveSettings));
  return row
    ? { yearStartMonth: row.yearStartMonth, workDays: [...row.workDays].sort() }
    : { yearStartMonth: 1, workDays: [...DEFAULT_WORK_DAYS] };
}

export async function saveLeaveSettings(
  ctx: Pick<Ctx, "userId">,
  input: LeaveSettingsInput,
): Promise<LeaveSettings> {
  const parsed = leaveSettingsInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  await listLeaveTypes(ctx);
  const values = { yearStartMonth: parsed.data.yearStartMonth, workDays: [...parsed.data.workDays].sort() };
  await getDb()
    .update(leaveSettings)
    .set({ ...values, updatedAt: new Date() })
    .where(userScoped(ctx).owns(leaveSettings));
  return values;
}

/* The days off of the year (the patron saint) */

export type RestDay = typeof leaveRestDays.$inferSelect;

export async function listRestDays(ctx: Pick<Ctx, "userId">): Promise<RestDay[]> {
  return getDb()
    .select()
    .from(leaveRestDays)
    .where(userScoped(ctx).owns(leaveRestDays))
    .orderBy(asc(leaveRestDays.month), asc(leaveRestDays.day));
}

/** Adds a day off of the year; a date the person already has is `conflict`. */
export async function addRestDay(ctx: Pick<Ctx, "userId">, input: RestDayInput): Promise<RestDay> {
  const parsed = restDayInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  const { month, day } = parsed.data;
  // 29 February is a day of the leap years only; 31 April is a day of no year.
  if (new Date(Date.UTC(2024, month - 1, day)).getUTCMonth() !== month - 1) {
    throw new TimeOffError("invalid_input");
  }
  try {
    const [row] = await getDb().insert(leaveRestDays).values(userScoped(ctx).stamp(parsed.data)).returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error)) throw new TimeOffError("conflict");
    throw error;
  }
}

export async function deleteRestDay(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const deleted = await getDb()
    .delete(leaveRestDays)
    .where(and(eq(leaveRestDays.id, id), userScoped(ctx).owns(leaveRestDays)))
    .returning({ id: leaveRestDays.id });
  if (deleted.length === 0) throw new TimeOffError("not_found");
}

/* Allowances by type */

export interface TypeAllowance {
  typeId: string;
  year: number;
  days: number | null;
  carriedDays: number | null;
}

const asNumber = (value: string | null): number | null => (value === null ? null : Number(value));

/** Every allowance the person stated, by year then by type order. */
export async function listTypeAllowances(ctx: Pick<Ctx, "userId">): Promise<TypeAllowance[]> {
  const rows = await getDb()
    .select({
      typeId: leaveAllowances.typeId,
      year: leaveAllowances.year,
      days: leaveAllowances.days,
      carriedDays: leaveAllowances.carriedDays,
    })
    .from(leaveAllowances)
    .innerJoin(leaveTypes, eq(leaveTypes.id, leaveAllowances.typeId))
    .where(userScoped(ctx).owns(leaveAllowances))
    .orderBy(asc(leaveAllowances.year), asc(leaveTypes.position), asc(leaveTypes.id));
  return rows.map((row) => ({ ...row, days: asNumber(row.days), carriedDays: asNumber(row.carriedDays) }));
}

/**
 * States what a year grants of a type, replacing what was there. A type with an old kind writes
 * the same days in the old row of the year too (R5g: the old columns stay written until R5f).
 */
export async function saveTypeAllowance(
  ctx: Pick<Ctx, "userId">,
  typeId: string,
  year: number,
  input: AllowanceInput,
): Promise<TypeAllowance> {
  const parsed = allowanceInputSchema.safeParse(input);
  if (!parsed.success) throw new TimeOffError("invalid_input");
  if (!Number.isInteger(year) || year < 1990 || year > 2200) throw new TimeOffError("invalid_input");
  const type = await leaveTypeOf(ctx, typeId);
  const fixed = (value: number | null) => (value === null ? null : value.toFixed(2));
  const values = { days: fixed(parsed.data.days), carriedDays: fixed(parsed.data.carriedDays) };
  const legacy = legacyAllowanceField(type.legacyKind);
  await getDb().transaction(async (tx) => {
    await tx
      .insert(leaveAllowances)
      .values(userScoped(ctx).stamp({ typeId, year, ...values }))
      .onConflictDoUpdate({
        target: [leaveAllowances.userId, leaveAllowances.typeId, leaveAllowances.year],
        set: { ...values, updatedAt: new Date() },
      });
    if (legacy === null) return;
    await tx
      .insert(timeoffAllowances)
      .values(userScoped(ctx).stamp({ year, [legacy]: values.days }))
      .onConflictDoUpdate({
        target: [timeoffAllowances.userId, timeoffAllowances.year],
        set: { [legacy]: values.days, updatedAt: new Date() },
      });
  });
  return { typeId, year, days: parsed.data.days, carriedDays: parsed.data.carriedDays };
}

/* What every rule of a year reads */

interface LeaveWindow {
  from: CivilDate;
  to: CivilDate;
}

/** The days of a leave year: from its first month, twelve months long. */
export function leaveYearWindow(year: number, startMonth = 1): LeaveWindow {
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  const from = `${pad(year, 4)}-${pad(startMonth, 2)}-01`;
  const end = new Date(Date.UTC(year, startMonth - 1 + 12, 0));
  return { from, to: end.toISOString().slice(0, 10) };
}

/** The calendar years a window touches. */
export function yearsOf(window: LeaveWindow): number[] {
  const first = Number(window.from.slice(0, 4));
  const last = Number(window.to.slice(0, 4));
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

interface LeaveContext {
  types: LeaveTypeView[];
  settings: LeaveSettings;
  /** The holidays of the person's calendars and their days off of the year, for the years asked. */
  holidays: Set<CivilDate>;
  /** Whether the person keeps a calendar of holidays: without one only the week is known. */
  hasHolidayCalendar: boolean;
}

/** The types, the settings and the days nobody books, for the calendar years asked about. */
export async function leaveContext(
  ctx: Pick<Ctx, "userId">,
  years: readonly number[],
): Promise<LeaveContext> {
  const [{ types, settings }, { days: holidays, hasCalendar }, restDays] = await Promise.all([
    startedTypes(ctx),
    holidaysOf(ctx, years),
    listRestDays(ctx),
  ]);
  for (const year of years) {
    for (const rest of restDays) {
      const date = `${String(year).padStart(4, "0")}-${String(rest.month).padStart(2, "0")}-${String(rest.day).padStart(2, "0")}`;
      // 29 February of a year that has none is no date.
      if (new Date(`${date}T00:00:00Z`).getUTCDate() === rest.day) holidays.add(date);
    }
  }
  return { types, settings, holidays, hasHolidayCalendar: hasCalendar };
}
