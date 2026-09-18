/**
 * Where the Expenses screen keeps its state: the URL (spec §8.4 point 2).
 *
 * Every filter is a query parameter, so the page is rendered by the server and the presets, the
 * period stepper, the category menu and the account menu are plain links that work before any
 * JavaScript has run. Nothing in here reads a database or a clock of its own: "today" is passed
 * in, the same way the rest of the repository does it (spec §4.3).
 */

import type { Params } from "@/modules/accounts/ui/controls";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/transactions/rules";
import { addDays, addMonths, type CivilDate, isCivilDate, lastDayOfMonth, monthKey } from "@/platform/dates";

/** The four presets of the design, in the order the segmented control shows them. */
export const RANGE_PRESETS = ["thisMonth", "lastMonth", "last3Months", "ytd"] as const;

export type RangePreset = (typeof RANGE_PRESETS)[number];

/** The range the screen opens on. */
export const DEFAULT_PRESET: RangePreset = "thisMonth";

/** The five sortable columns of the design, matching `TransactionSort` in `queries.ts`. */
export const SORT_KEYS = ["date", "payee", "account", "category", "amount"] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

export const DEFAULT_SORT: SortKey = "date";

/**
 * The direction a column starts in, and the same table `queries.ts` keeps: a date and an amount
 * read biggest first, a name reads A to Z. It has to agree with the read model, or an address
 * with no `dir` would draw one arrow and order by the other.
 */
export const DEFAULT_DIRECTION: Record<SortKey, SortDirection> = {
  date: "desc",
  amount: "desc",
  payee: "asc",
  account: "asc",
  category: "asc",
};

/**
 * The pseudo-id the category filter uses for "filed under no category at all". A real category id
 * is a UUID, so the literal can never collide with one.
 */
export const UNCATEGORISED = "none";

export interface DateRange {
  from: CivilDate;
  to: CivilDate;
}

const DAY_MS = 86_400_000;

function utcMillis(date: CivilDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

/** How many days a range covers, both ends included. */
export function daysInRange(range: DateRange): number {
  return Math.round((utcMillis(range.to) - utcMillis(range.from)) / DAY_MS) + 1;
}

/** Whole months from `from` to `to`, both included. */
function monthSpan(range: DateRange): number {
  const from = monthKey(range.from);
  const to = monthKey(range.to);
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth) + 1;
}

/**
 * Whether the range is made of whole calendar months: it starts on a first and ends on a last day.
 * The period stepper then walks in months rather than in days, which is what makes "previous" on
 * a 31-day August land on a 30-day September and not three days into it (the prototype's own
 * `shiftRange` makes the same distinction).
 */
export function isWholeMonths(range: DateRange): boolean {
  return range.from.endsWith("-01") && range.to === lastDayOfMonth(monthKey(range.to));
}

/** The range is one single calendar month, which the label shows as a month name. */
export function isSingleMonth(range: DateRange): boolean {
  return isWholeMonths(range) && monthKey(range.from) === monthKey(range.to);
}

/**
 * The window of a preset, computed from the user's own today (spec §8.4 point 6).
 *
 * All four are whole-month windows, "Year to date" included: a range that ends mid-month would
 * make the stepper walk in days, and stepping back from a nine-month window by 273 days is not
 * something anybody means. The current month is shown whole, exactly as "This month" is.
 */
export function presetRange(preset: RangePreset, today: CivilDate): DateRange {
  const month = monthKey(today);
  switch (preset) {
    case "thisMonth":
      return { from: month, to: lastDayOfMonth(month) };
    case "lastMonth": {
      const previous = addMonths(month, -1);
      return { from: previous, to: lastDayOfMonth(previous) };
    }
    case "last3Months":
      return { from: addMonths(month, -2), to: lastDayOfMonth(month) };
    case "ytd":
      return { from: `${today.slice(0, 4)}-01-01`, to: lastDayOfMonth(month) };
  }
}

/** The same window moved by `periods` of its own length; negative goes back in time. */
export function shiftRange(range: DateRange, periods: number): DateRange {
  if (periods === 0) return range;
  if (isWholeMonths(range)) {
    const step = periods * monthSpan(range);
    const to = addMonths(monthKey(range.to), step);
    return { from: addMonths(monthKey(range.from), step), to: lastDayOfMonth(to) };
  }
  const step = periods * daysInRange(range);
  return { from: addDays(range.from, step), to: addDays(range.to, step) };
}

/** Search parameters as a page receives them, before anything is known about them. */
export type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

function civilDate(value: string): CivilDate | null {
  return value !== "" && isCivilDate(value) ? value : null;
}

/**
 * Every id in the address goes straight into a `uuid` column of the read model, where a value
 * that is not one is not an empty result but an error: `?acc=x` costs the whole screen. So an id
 * is read like every other parameter here — understood or dropped — and one wrong letter in a
 * pasted address narrows nothing instead of taking the page down.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string): string | null {
  return UUID.test(value) ? value : null;
}

/**
 * What the filters ask the read model for. Structurally the `TransactionFilters` of
 * `modules/transactions/queries.ts`, written out here rather than imported: that module is
 * `server-only`, and this one is read by the table in the browser.
 *
 * An absent field is not a filter at all, which is how the read model reads it: `categoryIds`
 * left out means every category, and `null` inside it is the "Uncategorised" choice.
 */
export interface ReadFilters {
  from: CivilDate;
  to: CivilDate;
  accountIds?: readonly string[];
  categoryIds?: readonly (string | null)[];
  types?: readonly TransactionType[];
  payee?: string;
  /** Spec §7.2: hidden rows stay out of the totals unless they are asked for. */
  includeHidden?: boolean;
  sort: SortKey;
  direction: SortDirection;
}

export interface ExpensesQuery {
  /** `null` when the URL carries an explicit `from`/`to`, which wins over the presets. */
  preset: RangePreset | null;
  /** How many periods back from the base window; never negative, so never into the future. */
  offset: number;
  range: DateRange;
  /** The category filter as the menu shows it: real ids, plus `UNCATEGORISED` when selected. */
  categorySelection: string[];
  accountId: string | null;
  /** One movement type, or `null` for all of them (F2.5: how the giroconti are isolated). */
  type: TransactionType | null;
  search: string;
  showHidden: boolean;
  sort: SortKey;
  direction: SortDirection;
  /** Whether anything other than the date range narrows the list (the design's "Clear filters"). */
  filtered: boolean;
  /** The current parameters, for a control that changes one of them and keeps the rest. */
  params: Params;
  /** The same, minus everything a preset decides: picking one restarts from its own window. */
  presetParams: Params;
  /** The same, minus the offset, which `PeriodStepper` writes itself. */
  stepperParams: Params;
  /** The same, minus every filter: what "Clear filters" navigates to (the range survives). */
  clearedParams: Params;
}

/**
 * The screen's whole state, read from the URL. An unreadable value is not an error: it falls back
 * to the default, because a hand-edited address should still render a page.
 */
export function parseExpensesQuery(raw: RawParams, today: CivilDate): ExpensesQuery {
  const from = civilDate(one(raw.from));
  const to = civilDate(one(raw.to));
  const custom = from !== null && to !== null && from <= to;
  const wanted = one(raw.preset);
  const preset = custom ? null : (RANGE_PRESETS.find((key) => key === wanted) ?? DEFAULT_PRESET);
  const offset = Math.max(0, Math.trunc(Number(one(raw.off))) || 0);
  const base = custom ? { from, to } : presetRange(preset ?? DEFAULT_PRESET, today);
  const range = shiftRange(base, -offset);

  const categorySelection = [
    ...new Set(
      one(raw.cat)
        .split(",")
        .map((id) => id.trim())
        // `UNCATEGORISED` is this screen's own literal, not an id: it is the one value the read
        // model turns into `null` rather than comparing to a column.
        .filter((id) => id === UNCATEGORISED || uuid(id) !== null),
    ),
  ];
  const accountId = uuid(one(raw.acc));
  const type = TRANSACTION_TYPES.find((known) => known === one(raw.type)) ?? null;
  const search = one(raw.q);
  const showHidden = one(raw.hidden) === "1";
  const sort = SORT_KEYS.find((key) => key === one(raw.sort)) ?? DEFAULT_SORT;
  const wantedDirection = one(raw.dir);
  const direction: SortDirection =
    wantedDirection === "asc" || wantedDirection === "desc" ? wantedDirection : DEFAULT_DIRECTION[sort];

  const filters: Params = {
    cat: categorySelection.length > 0 ? categorySelection.join(",") : undefined,
    acc: accountId ?? undefined,
    type: type ?? undefined,
    q: search || undefined,
    hidden: showHidden ? "1" : undefined,
  };
  const order: Params = {
    sort: sort === DEFAULT_SORT ? undefined : sort,
    dir: direction === DEFAULT_DIRECTION[sort] ? undefined : direction,
  };
  const period: Params = {
    preset: preset === null || preset === DEFAULT_PRESET ? undefined : preset,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
    off: offset > 0 ? String(offset) : undefined,
  };

  return {
    preset,
    offset,
    range,
    categorySelection,
    accountId,
    type,
    search,
    showHidden,
    sort,
    direction,
    filtered:
      categorySelection.length > 0 || accountId !== null || type !== null || search !== "" || showHidden,
    params: { ...period, ...filters, ...order },
    presetParams: { ...filters, ...order },
    stepperParams: { ...period, off: undefined, ...filters, ...order },
    clearedParams: { ...period, ...order },
  };
}

/** What the read model is asked for, once the URL has been understood. */
export function filtersOf(query: ExpensesQuery): ReadFilters {
  const categoryIds: (string | null)[] = query.categorySelection.map((id) =>
    id === UNCATEGORISED ? null : id,
  );
  return {
    from: query.range.from,
    to: query.range.to,
    accountIds: query.accountId === null ? undefined : [query.accountId],
    categoryIds: categoryIds.length === 0 ? undefined : categoryIds,
    types: query.type === null ? undefined : [query.type],
    payee: query.search === "" ? undefined : query.search,
    includeHidden: query.showHidden ? true : undefined,
    sort: query.sort,
    direction: query.direction,
  };
}

/** The category filter with one entry toggled, as the menu's links need it. */
export function toggleCategory(selection: readonly string[], id: string): string[] {
  return selection.includes(id) ? selection.filter((current) => current !== id) : [...selection, id];
}

/** The parameter value a category link writes; an empty string drops the parameter. */
export function categoryParam(selection: readonly string[]): string {
  return selection.join(",");
}
