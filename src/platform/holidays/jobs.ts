/**
 * The daily refresh of the subscribed holiday calendars (M3: "aggiornati online").
 *
 * Daily and not hourly because a public holiday moves about once a year, and the services are
 * somebody else's to be polite to. This year and the next are fetched: leave is booked ahead, and
 * a January day planned in November has to know whether it is Epiphany before the year turns.
 *
 * A calendar whose source fails keeps the days it already had — the failure is written on the row
 * and shown in Settings, and the next day's pass tries again. An empty year is never written over
 * a good one: `refreshCalendar` only writes what it actually received.
 */
import "server-only";
import { forEachUser } from "@/modules/users/jobs";
import { redactForLog } from "@/platform/auth/logger";
import { today } from "@/platform/dates";
import type { JobDefinition } from "@/platform/jobs/registry";
import type { JobDetail } from "@/platform/jobs/schema";
import { listCalendars, markCalendarFailed, refreshCalendar } from "./service";
import type { HolidayFetchOptions } from "./sources";

/** This year and the next: leave is booked ahead of itself. */
export function yearsToRefresh(current: number): number[] {
  return [current, current + 1];
}

export function createHolidaysRefreshJob(options: HolidayFetchOptions = {}): JobDefinition {
  return {
    name: "holidays-refresh",
    tier: "daily",
    async run(): Promise<JobDetail> {
      const now = new Date();
      let calendars = 0;
      let refreshed = 0;
      let days = 0;
      let failures = 0;

      const counts = await forEachUser("holidays-refresh", async (_person, ctx) => {
        const mine = await listCalendars(ctx);
        calendars += mine.length;
        for (const calendar of mine) {
          for (const year of yearsToRefresh(Number(today(ctx.timeZone, now).slice(0, 4)))) {
            try {
              days += await refreshCalendar(ctx, calendar, year, ctx.locale, options, now);
              refreshed += 1;
            } catch (error) {
              failures += 1;
              const message = error instanceof Error ? error.message : String(error);
              await markCalendarFailed(calendar.id, message, now);
              console.error("[holidays-refresh] a calendar could not be refreshed", redactForLog(error));
            }
          }
        }
      });

      return { ...counts, calendars, refreshed, days, failures };
    },
  };
}

export const holidaysRefreshJob = createHolidaysRefreshJob();
