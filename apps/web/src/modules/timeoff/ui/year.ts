// The filter of the table of the Time off page, in the URL beside the year.
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
