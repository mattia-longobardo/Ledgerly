// The year a Time off URL asks for (`?year=`): a whole year from 1990 up to `last`; anything else is
// the current one. The page and Time off › Settings read it the same way.
export function yearOf(asked: string | string[] | null | undefined, current: number, last: number): number {
  const year = Number(Array.isArray(asked) ? asked[0] : asked);
  return Number.isInteger(year) && year >= 1990 && year <= last ? year : current;
}

/** Which rows the table shows; the design's three filters. */
export const FILTERS = ["all", "taken", "planned"] as const;
export type Filter = (typeof FILTERS)[number];

export function filterOf(asked: string | null): Filter {
  return FILTERS.find((one) => one === asked) ?? "all";
}

/** The address of a year of the page, with its filter. */
export function yearHref(year: number, filter: Filter): string {
  return `/timeoff?year=${year}${filter === "all" ? "" : `&filter=${filter}`}`;
}
