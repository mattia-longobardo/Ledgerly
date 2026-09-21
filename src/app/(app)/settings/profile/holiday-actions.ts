// src/app/(app)/settings/profile/holiday-actions.ts — the holiday calendars of Settings › Profile
// (M3): list the places the two services can name, subscribe to one, drop one, fetch one again.
//
// The two country lists are fetched on demand rather than on every render of the page: they change
// about as often as a country does, and a settings page should not wait on somebody else's server
// to draw itself.
"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/platform/auth/session";
import { today } from "@/platform/dates";
import {
  HolidayServiceError,
  addCalendar,
  listCalendars,
  markCalendarFailed,
  refreshCalendar,
  removeCalendar,
} from "@/platform/holidays/service";
import { yearsToRefresh } from "@/platform/holidays/jobs";
import {
  type HolidayCountry,
  type HolidaySubdivision,
  HolidayError,
  listCountries,
  listSubdivisions,
} from "@/platform/holidays/sources";
import { HOLIDAY_SOURCES, type HolidaySource } from "@/platform/holidays/rules";

export type HolidayActionError = "unreachable" | "duplicate" | "tooMany" | "notFound" | "invalid" | "failed";

export type HolidayActionResult = { ok: true } | { ok: false; error: HolidayActionError };

function revalidate(): void {
  revalidatePath("/settings/profile");
  // The leave screen decides what can be booked from these very days.
  revalidatePath("/timeoff");
}

function failed(error: unknown): { ok: false; error: HolidayActionError } {
  if (error instanceof HolidayServiceError) {
    if (error.code === "duplicate") return { ok: false, error: "duplicate" };
    if (error.code === "too_many") return { ok: false, error: "tooMany" };
    if (error.code === "not_found") return { ok: false, error: "notFound" };
    return { ok: false, error: "invalid" };
  }
  if (error instanceof HolidayError) return { ok: false, error: "unreachable" };
  return { ok: false, error: "failed" };
}

/** Every country either service can answer for, in the user's own language. */
export async function holidayCountriesAction(): Promise<
  { ok: true; countries: HolidayCountry[] } | { ok: false; error: HolidayActionError }
> {
  const ctx = await requireSession();
  try {
    return { ok: true, countries: await listCountries(ctx.locale) };
  } catch (error) {
    return failed(error);
  }
}

/** The places inside a country, when the source can name them. */
export async function holidaySubdivisionsAction(
  source: string,
  country: string,
): Promise<{ ok: true; places: HolidaySubdivision[] } | { ok: false; error: HolidayActionError }> {
  const ctx = await requireSession();
  if (!(HOLIDAY_SOURCES as readonly string[]).includes(source)) return { ok: false, error: "invalid" };
  try {
    const places = await listSubdivisions(source as HolidaySource, country, ctx.locale);
    return { ok: true, places };
  } catch (error) {
    return failed(error);
  }
}

/**
 * Subscribes to a calendar and fetches it straight away, so the days show up in the same breath as
 * the calendar rather than at tomorrow's job. A fetch that fails still leaves the subscription:
 * the daily pass will try again, and the card says what went wrong meanwhile.
 */
export async function addHolidayCalendarAction(input: {
  source: string;
  country: string;
  subdivision: string | null;
  label: string;
}): Promise<HolidayActionResult> {
  const ctx = await requireSession();
  if (!(HOLIDAY_SOURCES as readonly string[]).includes(input.source)) {
    return { ok: false, error: "invalid" };
  }
  try {
    const calendar = await addCalendar(ctx, {
      source: input.source as HolidaySource,
      country: input.country,
      subdivision: input.subdivision,
      label: input.label,
    });
    await fetchYears(ctx, calendar);
  } catch (error) {
    return failed(error);
  }
  revalidate();
  return { ok: true };
}

export async function removeHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  const ctx = await requireSession();
  try {
    await removeCalendar(ctx, id);
  } catch (error) {
    return failed(error);
  }
  revalidate();
  return { ok: true };
}

/** "Update now" for one calendar: the same two years the daily job keeps. */
export async function refreshHolidayCalendarAction(id: string): Promise<HolidayActionResult> {
  const ctx = await requireSession();
  const calendar = (await listCalendars(ctx)).find((one) => one.id === id);
  if (!calendar) return { ok: false, error: "notFound" };
  try {
    await fetchYears(ctx, calendar);
  } catch (error) {
    return failed(error);
  }
  revalidate();
  return { ok: true };
}

/** This year and the next, the same window the job keeps; a failure is recorded on the row. */
async function fetchYears(
  ctx: Awaited<ReturnType<typeof requireSession>>,
  calendar: Awaited<ReturnType<typeof listCalendars>>[number],
): Promise<void> {
  const current = Number(today(ctx.timeZone).slice(0, 4));
  for (const year of yearsToRefresh(current)) {
    try {
      await refreshCalendar(ctx, calendar, year, ctx.locale);
    } catch (error) {
      await markCalendarFailed(calendar.id, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
