import { describe, expect, it } from "vitest";
import {
  categoryParam,
  filtersOf,
  isWholeMonths,
  parseExpensesQuery,
  presetRange,
  shiftRange,
  toggleCategory,
  UNCATEGORISED,
} from "./filters";

const TODAY = "2026-09-16";

/** Real ids: the read model puts them in `uuid` columns, so the parser only accepts that shape. */
const ACCOUNT = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a01";
const OTHER_ACCOUNT = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a02";
const CATEGORY_A = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a03";
const CATEGORY_B = "018f3a36-5c2e-7b1a-9d44-2b7c1f4e9a04";

describe("presetRange", () => {
  it("gives the four presets of the design as whole-month windows", () => {
    expect(presetRange("thisMonth", TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(presetRange("lastMonth", TODAY)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(presetRange("last3Months", TODAY)).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetRange("ytd", TODAY)).toEqual({ from: "2026-01-01", to: "2026-09-30" });
  });

  it("counts the current month in, and crosses a year end", () => {
    expect(presetRange("last3Months", "2026-01-05")).toEqual({ from: "2025-11-01", to: "2026-01-31" });
    expect(presetRange("lastMonth", "2026-01-05")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
});

describe("shiftRange", () => {
  it("walks whole-month windows by their own span, month lengths and all", () => {
    expect(shiftRange({ from: "2026-09-01", to: "2026-09-30" }, -1)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(shiftRange({ from: "2026-07-01", to: "2026-09-30" }, -1)).toEqual({
      from: "2026-04-01",
      to: "2026-06-30",
    });
  });

  it("walks a window that is not whole months by its own number of days", () => {
    const range = { from: "2026-09-10", to: "2026-09-12" };
    expect(isWholeMonths(range)).toBe(false);
    expect(shiftRange(range, -1)).toEqual({ from: "2026-09-07", to: "2026-09-09" });
  });

  it("leaves the window alone when nothing moves", () => {
    const range = { from: "2026-09-01", to: "2026-09-30" };
    expect(shiftRange(range, 0)).toBe(range);
  });
});

describe("parseExpensesQuery", () => {
  it("opens on this month with nothing filtered", () => {
    const query = parseExpensesQuery({}, TODAY);
    expect(query.preset).toBe("thisMonth");
    expect(query.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(query.offset).toBe(0);
    expect(query.sort).toBe("date");
    expect(query.direction).toBe("desc");
    expect(query.filtered).toBe(false);
    expect(query.params).toEqual({
      preset: undefined,
      from: undefined,
      to: undefined,
      off: undefined,
      cat: undefined,
      acc: undefined,
      type: undefined,
      q: undefined,
      hidden: undefined,
      sort: undefined,
      dir: undefined,
    });
  });

  it("draws the chart by day on short ranges and by month on long ones, unless told (F2.5)", () => {
    expect(parseExpensesQuery({}, TODAY).grain).toBe("day");
    expect(parseExpensesQuery({ preset: "last3Months" }, TODAY).grain).toBe("month");
    const chosen = parseExpensesQuery({ preset: "last3Months", grain: "day" }, TODAY);
    expect(chosen.grain).toBe("day");
    // Chosen, it travels with every other control and survives "Clear filters": it is no filter.
    expect(chosen.params.grain).toBe("day");
    expect(chosen.presetParams.grain).toBe("day");
    expect(chosen.clearedParams.grain).toBe("day");
    expect(chosen.filtered).toBe(false);
    expect(parseExpensesQuery({ grain: "week" }, TODAY).params.grain).toBeUndefined();
  });

  it("reads the type filter and ignores a type it does not know (F2.5)", () => {
    const transfers = parseExpensesQuery({ type: "transfer" }, TODAY);
    expect(transfers.type).toBe("transfer");
    expect(transfers.filtered).toBe(true);
    expect(transfers.params.type).toBe("transfer");
    expect(transfers.presetParams.type).toBe("transfer");
    // "Clear filters" takes the type off with the rest.
    expect(transfers.clearedParams.type).toBeUndefined();
    expect(filtersOf(transfers).types).toEqual(["transfer"]);

    const unknown = parseExpensesQuery({ type: "refund" }, TODAY);
    expect(unknown.type).toBeNull();
    expect(unknown.filtered).toBe(false);
    expect(filtersOf(unknown).types).toBeUndefined();
  });

  it("steps back by whole periods, never into the future", () => {
    expect(parseExpensesQuery({ off: "2" }, TODAY).range).toEqual({
      from: "2026-07-01",
      to: "2026-07-31",
    });
    expect(parseExpensesQuery({ off: "-3" }, TODAY).offset).toBe(0);
    expect(parseExpensesQuery({ off: "nonsense" }, TODAY).offset).toBe(0);
  });

  it("lets an explicit from/to win over the presets", () => {
    const query = parseExpensesQuery({ preset: "ytd", from: "2026-03-04", to: "2026-03-06" }, TODAY);
    expect(query.preset).toBeNull();
    expect(query.range).toEqual({ from: "2026-03-04", to: "2026-03-06" });
    expect(query.params.preset).toBeUndefined();
    expect(query.params.from).toBe("2026-03-04");
  });

  it("falls back to the default rather than refusing an unreadable address", () => {
    const query = parseExpensesQuery(
      {
        preset: "sometime",
        from: "not-a-date",
        to: "2026-03-06",
        sort: "colour",
        dir: "sideways",
        acc: "x",
        cat: "x",
      },
      TODAY,
    );
    expect(query.preset).toBe("thisMonth");
    expect(query.sort).toBe("date");
    expect(query.direction).toBe("desc");
    // An id that is not one reaches a `uuid` column and takes the whole screen down with it.
    expect(query.accountId).toBeNull();
    expect(query.categorySelection).toEqual([]);
    expect(query.filtered).toBe(false);
    expect(query.params.acc).toBeUndefined();
    expect(query.params.cat).toBeUndefined();
  });

  it("drops the ids that are not ids and keeps the ones that are", () => {
    // One wrong letter in a pasted address: the rest of the filter still narrows the list.
    const query = parseExpensesQuery(
      { acc: `${ACCOUNT}x`, cat: `${CATEGORY_A},nonsense,${UNCATEGORISED}` },
      TODAY,
    );
    expect(query.accountId).toBeNull();
    expect(query.categorySelection).toEqual([CATEGORY_A, UNCATEGORISED]);
    expect(filtersOf(query).accountIds).toBeUndefined();
    expect(filtersOf(query).categoryIds).toEqual([CATEGORY_A, null]);
  });

  it("refuses a backwards range and keeps the preset", () => {
    const query = parseExpensesQuery({ from: "2026-03-06", to: "2026-03-04" }, TODAY);
    expect(query.preset).toBe("thisMonth");
  });

  it("reads the filters, deduplicating the categories and keeping their order", () => {
    const query = parseExpensesQuery(
      {
        cat: `${CATEGORY_B}, ${CATEGORY_A} ,${CATEGORY_B},${UNCATEGORISED}`,
        acc: ACCOUNT,
        q: " Netflix ",
        hidden: "1",
        dir: "asc",
      },
      TODAY,
    );
    expect(query.categorySelection).toEqual([CATEGORY_B, CATEGORY_A, UNCATEGORISED]);
    expect(query.accountId).toBe(ACCOUNT);
    expect(query.search).toBe("Netflix");
    expect(query.showHidden).toBe(true);
    expect(query.direction).toBe("asc");
    expect(query.filtered).toBe(true);
  });

  it("carries the right parameters for each control", () => {
    const query = parseExpensesQuery({ preset: "lastMonth", off: "1", cat: CATEGORY_A, q: "x" }, TODAY);
    // A preset restarts from its own window: no offset, no explicit range.
    expect(query.presetParams).toEqual({
      cat: CATEGORY_A,
      q: "x",
      acc: undefined,
      type: undefined,
      hidden: undefined,
      sort: undefined,
      dir: undefined,
    });
    // The stepper writes the offset itself and keeps the rest.
    expect(query.stepperParams.off).toBeUndefined();
    expect(query.stepperParams.preset).toBe("lastMonth");
    // "Clear filters" keeps the window the reader is looking at.
    expect(query.clearedParams).toEqual({
      preset: "lastMonth",
      from: undefined,
      to: undefined,
      off: "1",
      sort: undefined,
      dir: undefined,
    });
  });

  it("takes only the first value of a repeated parameter", () => {
    expect(parseExpensesQuery({ acc: [ACCOUNT, OTHER_ACCOUNT] }, TODAY).accountId).toBe(ACCOUNT);
  });
});

describe("filtersOf", () => {
  it("asks the read model for exactly what the URL says", () => {
    const query = parseExpensesQuery(
      { cat: `${CATEGORY_A},${UNCATEGORISED}`, acc: ACCOUNT, q: "netflix", hidden: "1", sort: "amount" },
      TODAY,
    );
    expect(filtersOf(query)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      accountIds: [ACCOUNT],
      categoryIds: [CATEGORY_A, null],
      types: undefined,
      payee: "netflix",
      includeHidden: true,
      sort: "amount",
      direction: "desc",
    });
  });

  it("leaves out every filter nobody set, so an absent one filters nothing", () => {
    expect(filtersOf(parseExpensesQuery({}, TODAY))).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      accountIds: undefined,
      categoryIds: undefined,
      types: undefined,
      payee: undefined,
      includeHidden: undefined,
      sort: "date",
      direction: "desc",
    });
  });
});

describe("sort directions", () => {
  it("starts each column the way the read model orders it", () => {
    expect(parseExpensesQuery({ sort: "payee" }, TODAY).direction).toBe("asc");
    expect(parseExpensesQuery({ sort: "account" }, TODAY).direction).toBe("asc");
    expect(parseExpensesQuery({ sort: "category" }, TODAY).direction).toBe("asc");
    expect(parseExpensesQuery({ sort: "amount" }, TODAY).direction).toBe("desc");
  });

  it("keeps the direction out of the URL only when it is that column's own", () => {
    expect(parseExpensesQuery({ sort: "payee", dir: "asc" }, TODAY).params.dir).toBeUndefined();
    expect(parseExpensesQuery({ sort: "payee", dir: "desc" }, TODAY).params.dir).toBe("desc");
    expect(parseExpensesQuery({ dir: "asc" }, TODAY).params.dir).toBe("asc");
  });
});

describe("toggleCategory", () => {
  it("adds what is missing and takes away what is there", () => {
    expect(toggleCategory([], "a")).toEqual(["a"]);
    expect(toggleCategory(["a", "b"], "a")).toEqual(["b"]);
    expect(categoryParam(toggleCategory(["a"], "b"))).toBe("a,b");
    expect(categoryParam(toggleCategory(["a"], "a"))).toBe("");
  });
});
