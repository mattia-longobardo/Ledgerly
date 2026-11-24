import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../context";
import { type CivilDate, today } from "../../shared/dates";
import { getDb } from "../db/client";
import { userScoped } from "../db/scope";
import { type HolidaySource } from "./rules";
import { holidayCalendars, holidayDays } from "./schema";
import { type HolidayFetchOptions, fetchHolidays } from "./sources";

type HolidayCalendar = typeof holidayCalendars.$inferSelect;

type HolidayServiceErrorCode = "not_found" | "invalid_input" | "duplicate" | "too_many";

/** Nobody keeps a hundred calendars, and an unbounded list is an unbounded daily job. */
export const MAX_CALENDARS = 10;

export class HolidayServiceError extends Error {
  constructor(readonly code: HolidayServiceErrorCode) {
    super(code);
    this.name = "HolidayServiceError";
  }
}

export async function listCalendars(ctx: Pick<Ctx, "userId">): Promise<HolidayCalendar[]> {
  return getDb()
    .select()
    .from(holidayCalendars)
    .where(userScoped(ctx).owns(holidayCalendars))
    .orderBy(asc(holidayCalendars.label), asc(holidayCalendars.id));
}

interface CalendarInput {
  source: HolidaySource;
  country: string;
  subdivision: string | null;
  label: string;
}

/** Subscribes to a calendar. The days themselves arrive on the first refresh, not here. */
export async function addCalendar(ctx: Pick<Ctx, "userId">, input: CalendarInput): Promise<HolidayCalendar> {
  const country = input.country.trim().toUpperCase();
  const label = input.label.trim();
  const subdivision = input.subdivision?.trim() || null;
  if (!/^[A-Z]{2}$/.test(country) || label === "" || label.length > 120) {
    throw new HolidayServiceError("invalid_input");
  }
  if ((await listCalendars(ctx)).length >= MAX_CALENDARS) throw new HolidayServiceError("too_many");

  const [row] = await getDb()
    .insert(holidayCalendars)
    .values(userScoped(ctx).stamp({ source: input.source, country, subdivision, label }))
    .onConflictDoNothing()
    .returning();
  // `onConflictDoNothing` returns nothing when the place is already subscribed: that is a duplicate,
  // not a failure to write.
  if (!row) throw new HolidayServiceError("duplicate");
  return row;
}

/** Unsubscribes, and the days go with it (the foreign key cascades). */
export async function removeCalendar(ctx: Pick<Ctx, "userId">, id: string): Promise<void> {
  const removed = await getDb()
    .delete(holidayCalendars)
    .where(and(eq(holidayCalendars.id, id), userScoped(ctx).owns(holidayCalendars)))
    .returning({ id: holidayCalendars.id });
  if (removed.length === 0) throw new HolidayServiceError("not_found");
}

/**
 * Fetches one calendar's year and writes it down, replacing whatever was there.
 *
 * Replace and not merge: a holiday that was moved or withdrawn has to be able to *leave*, and the
 * only thing that knows it has is the source. The fetch happens outside the transaction and the
 * write inside a short one (spec §4.3: no network inside a transaction), so a year is never half
 * replaced — and a source that fails writes nothing at all, leaving last year's good answer in
 * place rather than an empty year.
 */
export async function refreshCalendar(
  ctx: Pick<Ctx, "userId">,
  calendar: HolidayCalendar,
  year: number,
  language: string,
  options: HolidayFetchOptions = {},
  now: Date = new Date(),
): Promise<number> {
  const fetched = await fetchHolidays(
    calendar.source,
    calendar.country,
    calendar.subdivision,
    year,
    language,
    options,
  );

  await getDb().transaction(async (tx) => {
    await tx
      .delete(holidayDays)
      .where(and(eq(holidayDays.calendarId, calendar.id), eq(holidayDays.year, year)));
    if (fetched.length > 0) {
      await tx
        .insert(holidayDays)
        .values(
          fetched.map((holiday) =>
            userScoped(ctx).stamp({
              calendarId: calendar.id,
              on: holiday.on,
              year,
              name: holiday.name.slice(0, 200),
              nationwide: holiday.nationwide,
            }),
          ),
        )
        // Two feasts can share a date and a name in a badly formed answer; one row is enough.
        .onConflictDoNothing();
    }
    await tx
      .update(holidayCalendars)
      .set({ lastSyncedAt: now, lastError: null, updatedAt: now })
      .where(eq(holidayCalendars.id, calendar.id));
  });
  return fetched.length;
}

/** Records that a refresh did not work, without touching the days it failed to replace. */
export async function markCalendarFailed(
  calendarId: string,
  error: string,
  now: Date = new Date(),
): Promise<void> {
  await getDb()
    .update(holidayCalendars)
    .set({ lastError: error.slice(0, 300), updatedAt: now })
    .where(eq(holidayCalendars.id, calendarId));
}

/** How many days each of this user's calendars holds for a year, in one query. */
export async function countDaysByCalendar(
  ctx: Pick<Ctx, "userId">,
  year: number,
): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ calendarId: holidayDays.calendarId, days: count() })
    .from(holidayDays)
    .where(and(userScoped(ctx).owns(holidayDays), eq(holidayDays.year, year)))
    .groupBy(holidayDays.calendarId);
  return Object.fromEntries(rows.map((row) => [row.calendarId, Number(row.days)]));
}

/** One calendar's days for a year, for the list Settings shows under it. */
export async function daysOfCalendar(
  ctx: Pick<Ctx, "userId">,
  calendarId: string,
  year: number,
): Promise<{ on: CivilDate; name: string; nationwide: boolean }[]> {
  return getDb()
    .select({ on: holidayDays.on, name: holidayDays.name, nationwide: holidayDays.nationwide })
    .from(holidayDays)
    .where(
      and(
        userScoped(ctx).owns(holidayDays),
        eq(holidayDays.calendarId, calendarId),
        eq(holidayDays.year, year),
      ),
    )
    .orderBy(asc(holidayDays.on), asc(holidayDays.name));
}

/**
 * The public holidays of the calendars this person subscribed to, for the years asked about (M3),
 * and whether they keep any calendar, in one read. No calendar, no holiday: the app computes no
 * country's list since R5g (decision ST-20), and the screen says so.
 */
export async function holidaysOf(
  ctx: Pick<Ctx, "userId">,
  years: readonly number[],
): Promise<{ days: Set<CivilDate>; hasCalendar: boolean }> {
  const rows = await getDb()
    .select({ calendar: holidayCalendars.id, on: holidayDays.on })
    .from(holidayCalendars)
    .leftJoin(
      holidayDays,
      and(
        eq(holidayDays.calendarId, holidayCalendars.id),
        inArray(holidayDays.year, years.length === 0 ? [-1] : [...years]),
      ),
    )
    .where(userScoped(ctx).owns(holidayCalendars))
    .orderBy(asc(holidayCalendars.id), asc(holidayDays.on));
  return {
    days: new Set(rows.flatMap((row) => (row.on === null ? [] : [row.on]))),
    hasCalendar: rows.length > 0,
  };
}

/** This year and the next: leave is booked ahead of itself. */
export function yearsToRefresh(current: number): number[] {
  return [current, current + 1];
}

/**
 * Fetches a calendar's two years now, as «add» and «update now» of Time off › Settings do, so its
 * days show up at once rather than at tomorrow's job. A failure is written on the row and thrown.
 */
async function fetchAhead(
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale">,
  calendar: HolidayCalendar,
): Promise<void> {
  for (const year of yearsToRefresh(Number(today(ctx.timeZone).slice(0, 4)))) {
    try {
      await refreshCalendar(ctx, calendar, year, ctx.locale);
    } catch (error) {
      await markCalendarFailed(calendar.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}

/** «Add» of Time off › Settings: keeps a calendar and fetches its two years at once. */
export async function keepCalendar(
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale">,
  input: CalendarInput,
): Promise<HolidayCalendar> {
  const calendar = await addCalendar(ctx, input);
  await fetchAhead(ctx, calendar);
  return calendar;
}

/** «Update now» of one calendar: the same two years the daily job keeps. */
export async function refetchCalendar(
  ctx: Pick<Ctx, "userId" | "timeZone" | "locale">,
  id: string,
): Promise<void> {
  const calendar = (await listCalendars(ctx)).find((one) => one.id === id);
  if (!calendar) throw new HolidayServiceError("not_found");
  await fetchAhead(ctx, calendar);
}
