/**
 * Where the Expenses screen keeps its state: the URL (spec §8.4 point 2).
 *
 * Every filter is a query parameter, so the page is rendered by the server and the presets, the
 * period stepper, the category menu and the account menu are plain links that work before any
 * JavaScript has run. Nothing in here reads a database or a clock of its own: "today" is passed
 * in, the same way the rest of the repository does it (spec §4.3).
 */

import type { Params } from "@ledgerly/ui/url";
import { parsePeriodQuery } from "@ledgerly/ui/period";
import { TRANSACTION_TYPES, type TransactionType } from "@ledgerly/domain/transactions/client";
import type { CivilDate } from "@ledgerly/domain/shared/dates";

export {
  type DateRange,
  daysInRange,
  isWholeMonths,
  presetRange,
  RANGE_PRESETS,
  type RangePreset,
  shiftRange,
} from "@ledgerly/format/ranges";
import type { DateRange, RangePreset } from "@ledgerly/format/ranges";

/** What the spending chart adds up per point: days, or months (F2.5). */
export type ChartGrain = "day" | "month";

/** The five sortable columns of the design, matching `TransactionSort` in `queries.ts`. */
const SORT_KEYS = ["date", "payee", "account", "category", "amount"] as const;

export type SortKey = (typeof SORT_KEYS)[number];
export type SortDirection = "asc" | "desc";

const DEFAULT_SORT: SortKey = "date";

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

/** Search parameters as a page receives them, before anything is known about them. */
type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

/** A comma-separated parameter as its trimmed, non-empty entries (the first value if repeated). */
function list(value: string | string[] | undefined): string[] {
  return one(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
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
interface ReadFilters {
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
  /** The accounts ticked in the menu; empty is every account. */
  accountSelection: string[];
  /** The movement types ticked in the menu (F2.5: how the giroconti are isolated); empty is all. */
  typeSelection: TransactionType[];
  search: string;
  showHidden: boolean;
  sort: SortKey;
  direction: SortDirection;
  /** The spending chart's grain: the one the address chose, or the one the range calls for. */
  grain: ChartGrain;
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
  // The period is read as Overview and Accounts read theirs: one parser, one meaning of the address.
  const { preset, offset, range, grain, stepperParams: periodParams } = parsePeriodQuery(raw, today);

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
  // Several accounts and several types, comma-separated like the categories.
  const accountSelection = [...new Set(list(raw.acc).filter((id) => uuid(id) !== null))];
  const typeSelection = TRANSACTION_TYPES.filter((known) => list(raw.type).includes(known));
  const search = one(raw.q);
  const showHidden = one(raw.hidden) === "1";
  const sort = SORT_KEYS.find((key) => key === one(raw.sort)) ?? DEFAULT_SORT;
  const wantedDirection = one(raw.dir);
  const direction: SortDirection =
    wantedDirection === "asc" || wantedDirection === "desc" ? wantedDirection : DEFAULT_DIRECTION[sort];

  const filters: Params = {
    cat: categorySelection.length > 0 ? categorySelection.join(",") : undefined,
    acc: accountSelection.length > 0 ? accountSelection.join(",") : undefined,
    type: typeSelection.length > 0 ? typeSelection.join(",") : undefined,
    q: search || undefined,
    hidden: showHidden ? "1" : undefined,
  };
  // How the screen is drawn rather than what it holds: it travels with every link, and "Clear
  // filters" keeps it, like the sort.
  const order: Params = {
    sort: sort === DEFAULT_SORT ? undefined : sort,
    dir: direction === DEFAULT_DIRECTION[sort] ? undefined : direction,
    grain: periodParams.grain,
  };
  const period: Params = {
    preset: periodParams.preset,
    from: periodParams.from,
    to: periodParams.to,
    off: offset > 0 ? String(offset) : undefined,
  };

  return {
    preset,
    offset,
    range,
    categorySelection,
    accountSelection,
    typeSelection,
    search,
    showHidden,
    sort,
    direction,
    grain,
    filtered:
      categorySelection.length > 0 ||
      accountSelection.length > 0 ||
      typeSelection.length > 0 ||
      search !== "" ||
      showHidden,
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
    accountIds: query.accountSelection.length === 0 ? undefined : query.accountSelection,
    categoryIds: categoryIds.length === 0 ? undefined : categoryIds,
    types: query.typeSelection.length === 0 ? undefined : query.typeSelection,
    payee: query.search === "" ? undefined : query.search,
    includeHidden: query.showHidden ? true : undefined,
    sort: query.sort,
    direction: query.direction,
  };
}

/** A multiple-choice filter with one entry toggled, as the menus' links need it. */
export function toggle<T extends string>(selection: readonly T[], id: T): T[] {
  return selection.includes(id) ? selection.filter((current) => current !== id) : [...selection, id];
}

/** The parameter value a menu link writes; an empty string drops the parameter. */
export function listParam(selection: readonly string[]): string {
  return selection.join(",");
}
