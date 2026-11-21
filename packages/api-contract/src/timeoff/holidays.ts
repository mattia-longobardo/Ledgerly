// The holiday calendars of Time off › Settings (audit TOF-6: the settings of time off in the module):
// the places the two sources can name, the calendars the person keeps, and their writes. The days of
// a calendar reach the Time off page as `holidays` of `GET /timeoff/{year}`.
import { z } from "zod";
import { defineRoute } from "../route";
import { id, instant } from "../primitives";
import { byCalendar, CALENDAR_ID, HOLIDAY_ERRORS, HOLIDAY_SOURCES } from "./shared";

export const listHolidayCountries = defineRoute({
  id: "list_holiday_countries",
  method: "GET",
  path: "/timeoff/holidays/countries",
  scope: "read",
  capability: "timeoff",
  summary: "Every country either source can answer for, named in the person's language.",
  actions: ["holidayCountriesAction"],
  response: z.object({
    countries: z.array(
      z.object({
        source: z.enum(HOLIDAY_SOURCES),
        /** ISO 3166-1 alpha-2. */
        code: z.string(),
        name: z.string(),
        hasSubdivisions: z.boolean(),
      }),
    ),
  }),
  errors: ["unavailable"],
  example: {
    response: { countries: [{ source: "openholidays", code: "IT", name: "Italy", hasSubdivisions: true }] },
  },
});

export const listHolidaySubdivisions = defineRoute({
  id: "list_holiday_subdivisions",
  method: "GET",
  path: "/timeoff/holidays/subdivisions",
  scope: "read",
  capability: "timeoff",
  summary: "The places inside a country, when the source can name them; none otherwise.",
  actions: ["holidaySubdivisionsAction"],
  query: z.object({ source: z.enum(HOLIDAY_SOURCES), country: z.string().min(2).max(3) }),
  response: z.object({
    places: z.array(z.object({ code: z.string(), name: z.string(), path: z.string() })),
  }),
  errors: ["invalid", "unavailable"],
  example: {
    query: { source: "openholidays", country: "IT" },
    response: { places: [{ code: "IT-LO", name: "Lombardia", path: "Lombardia" }] },
  },
});

export const listHolidayCalendars = defineRoute({
  id: "list_holiday_calendars",
  method: "GET",
  path: "/timeoff/holidays/calendars",
  scope: "read",
  capability: "timeoff",
  summary: "The holiday calendars the person keeps, each with its days of this year and its last fetch.",
  actions: [],
  response: z.object({
    calendars: z.array(
      z.object({
        id: id(),
        label: z.string(),
        source: z.enum(HOLIDAY_SOURCES),
        country: z.string(),
        subdivision: z.string().nullable(),
        lastSyncedAt: instant().nullable(),
        /** Why the last fetch failed; null after a good one. */
        lastError: z.string().nullable(),
        /** Its days in the current year. */
        days: z.number().int(),
      }),
    ),
  }),
  errors: [],
  example: {
    response: {
      calendars: [
        {
          id: CALENDAR_ID,
          label: "Italy",
          source: "openholidays",
          country: "IT",
          subdivision: null,
          lastSyncedAt: "2026-11-21T03:00:00.000Z",
          lastError: null,
          days: 12,
        },
      ],
    },
  },
});

export const addHolidayCalendar = defineRoute({
  id: "add_holiday_calendar",
  method: "POST",
  path: "/timeoff/holidays/calendars",
  scope: "write",
  capability: "timeoff",
  summary:
    "Keeps a calendar and fetches this year and the next. A fetch that fails keeps the calendar, with " +
    "its error, and answers `unavailable`: the daily pass tries again.",
  actions: ["addHolidayCalendarAction"],
  body: z
    .object({
      source: z.enum(HOLIDAY_SOURCES),
      country: z.string().min(2).max(3),
      subdivision: z.string().nullable(),
      label: z.string().min(1).max(120),
    })
    .strict(),
  response: z.object({ id: id() }),
  status: 201,
  errors: HOLIDAY_ERRORS,
  example: {
    body: { source: "openholidays", country: "IT", subdivision: null, label: "Italy" },
    response: { id: CALENDAR_ID },
  },
});

export const removeHolidayCalendar = defineRoute({
  id: "remove_holiday_calendar",
  method: "DELETE",
  path: "/timeoff/holidays/calendars/{id}",
  scope: "write",
  capability: "timeoff",
  summary: "Stops keeping a calendar; its days are no longer holidays.",
  actions: ["removeHolidayCalendarAction"],
  params: byCalendar,
  response: null,
  status: 204,
  errors: ["not_found"],
  example: { params: { id: CALENDAR_ID } },
});

export const refreshHolidayCalendar = defineRoute({
  id: "refresh_holiday_calendar",
  method: "POST",
  path: "/timeoff/holidays/calendars/{id}/refresh",
  scope: "write",
  capability: "timeoff",
  summary: "Fetches a calendar again, this year and the next, as the daily pass does.",
  actions: ["refreshHolidayCalendarAction"],
  params: byCalendar,
  response: null,
  status: 204,
  errors: ["not_found", "unavailable"],
  example: { params: { id: CALENDAR_ID } },
});
