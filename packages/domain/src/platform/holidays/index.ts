// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { HOLIDAY_SOURCES } from "./rules";
export type { HolidaySource } from "./rules";
export {
  HolidayServiceError,
  addCalendar,
  countDaysByCalendar,
  listCalendars,
  markCalendarFailed,
  refreshCalendar,
  removeCalendar,
} from "./service";
export { HolidayError, listCountries, listSubdivisions } from "./sources";
export type { HolidayCountry, HolidayFetchOptions, HolidaySubdivision } from "./sources";
