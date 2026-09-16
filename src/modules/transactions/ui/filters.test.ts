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
      q: undefined,
      hidden: undefined,
      sort: undefined,
      dir: undefined,
    });
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
      { preset: "sometime", from: "not-a-date", to: "2026-03-06", sort: "colour", dir: "sideways" },
      TODAY,
    );
    expect(query.preset).toBe("thisMonth");
    expect(query.sort).toBe("date");
    expect(query.direction).toBe("desc");
  });

  it("refuses a backwards range and keeps the preset", () => {
    const query = parseExpensesQuery({ from: "2026-03-06", to: "2026-03-04" }, TODAY);
    expect(query.preset).toBe("thisMonth");
  });

  it("reads the filters, deduplicating the categories and keeping their order", () => {
    const query = parseExpensesQuery(
      { cat: `b, a ,b,${UNCATEGORISED}`, acc: "acc-1", q: " Netflix ", hidden: "1", dir: "asc" },
      TODAY,
    );
    expect(query.categorySelection).toEqual(["b", "a", UNCATEGORISED]);
    expect(query.accountId).toBe("acc-1");
    expect(query.search).toBe("Netflix");
    expect(query.showHidden).toBe(true);
    expect(query.direction).toBe("asc");
    expect(query.filtered).toBe(true);
  });

  it("carries the right parameters for each control", () => {
    const query = parseExpensesQuery({ preset: "lastMonth", off: "1", cat: "a", q: "x" }, TODAY);
    // A preset restarts from its own window: no offset, no explicit range.
    expect(query.presetParams).toEqual({
      cat: "a",
      q: "x",
      acc: undefined,
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
    expect(parseExpensesQuery({ acc: ["one", "two"] }, TODAY).accountId).toBe("one");
  });
});

describe("filtersOf", () => {
  it("asks the read model for exactly what the URL says", () => {
    const query = parseExpensesQuery(
      { cat: `cat-1,${UNCATEGORISED}`, acc: "acc-1", q: "netflix", hidden: "1", sort: "amount" },
      TODAY,
    );
    expect(filtersOf(query)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
      accountIds: ["acc-1"],
      categoryIds: ["cat-1", null],
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
