/**
 * Where a subscribed calendar's days come from (M3).
 *
 *  - `openholidays` (openholidaysapi.org) is the official European one: it names a country, its
 *    regions and its provinces, and it carries the local feasts a national list never has —
 *    Sant'Ambrogio on 7 December for the province of Milan, which is precisely the "city" a person
 *    means when they ask for one. About thirty countries, all European.
 *  - `nager` (date.nager.at) covers something like a hundred and ten countries, worldwide, but
 *    only names the country. It is what the rest of the world is fetched with.
 *
 * Both are free and need no key. The choice per country is made for the user: the finer of the two
 * wins wherever it reaches.
 */
export const HOLIDAY_SOURCES = ["openholidays", "nager"] as const;
export type HolidaySource = (typeof HOLIDAY_SOURCES)[number];
