import { describe, expect, it } from "vitest";
import {
  choiceOf,
  pickSourceCategory,
  planSourceCategory,
  sourceNamesShown,
  type StoredSourceCategory,
} from "./source-rules";

// The categories of a source that gives its own (rewrite plan N3.1, 12-account-modes.md §12.3).

const remote = { externalId: "sc-1", name: "Groceries", groupName: "Food" };

function stored(overrides: Partial<StoredSourceCategory> = {}): StoredSourceCategory {
  return {
    id: "row-1",
    name: "Groceries",
    groupName: "Food",
    categoryId: "added",
    addedCategoryId: "added",
    ...overrides,
  };
}

describe("what a reading does to a source's category", () => {
  it("adds one seen for the first time: it counts under its own category", () => {
    expect(planSourceCategory(undefined, remote, "added")).toEqual({
      categoryId: "added",
      insert: true,
      patch: {},
      restoreAdded: false,
    });
  });

  it("writes nothing for one it already holds as the source gives it", () => {
    expect(planSourceCategory(stored(), remote, "added")).toMatchObject({ insert: false, patch: {} });
  });

  it("keeps the person's match, whatever the reading says about the category added for it", () => {
    const plan = planSourceCategory(stored({ categoryId: "chosen" }), remote, "added");
    expect(plan.categoryId).toBe("chosen");
    expect(plan.patch).toEqual({});
  });

  it("follows the source's name and group", () => {
    const plan = planSourceCategory(
      stored(),
      { externalId: "sc-1", name: "Food shopping", groupName: "Home" },
      "added",
    );
    expect(plan.patch).toEqual({ name: "Food shopping", groupName: "Home" });
  });

  it("keeps the group it knows when a reading carries none", () => {
    expect(planSourceCategory(stored(), { ...remote, groupName: null }, "added").patch).toEqual({});
  });

  it("follows its own category when that one was replaced", () => {
    const plan = planSourceCategory(stored(), remote, "added-again");
    expect(plan).toMatchObject({
      categoryId: "added-again",
      patch: { addedCategoryId: "added-again", categoryId: "added-again" },
    });
  });

  it("falls back to its own category when the one it was matched to is gone, and brings it back", () => {
    const plan = planSourceCategory(stored({ categoryId: null }), remote, "added");
    expect(plan).toMatchObject({ categoryId: "added", patch: { categoryId: "added" }, restoreAdded: true });
  });
});

describe("whether a source's category is added or matched", () => {
  it("is added while it counts under its own category, matched under another one", () => {
    expect(choiceOf({ categoryId: "a", addedCategoryId: "a" })).toBe("added");
    expect(choiceOf({ categoryId: "b", addedCategoryId: "a" })).toBe("matched");
    expect(choiceOf({ categoryId: null, addedCategoryId: "a" })).toBe("added");
  });
});

describe("the source's category a movement written here is sent with", () => {
  it("is none when no category of the source counts under the chosen one", () => {
    expect(pickSourceCategory([], "Restaurants")).toBeNull();
  });

  it("is the one with the same name, before a more used one", () => {
    expect(
      pickSourceCategory(
        [
          { externalId: "sc-bar", name: "Bar, cafe", count: 40 },
          { externalId: "sc-rest", name: "restaurants ", count: 2 },
        ],
        "Restaurants",
      ),
    ).toBe("sc-rest");
  });

  it("is the most used one when none has the name, and the same one every time on a tie", () => {
    const candidates = [
      { externalId: "sc-b", name: "Tobacco", count: 12 },
      { externalId: "sc-a", name: "Alcohol", count: 12 },
      { externalId: "sc-c", name: "Bar", count: 3 },
    ];
    expect(pickSourceCategory(candidates, "Vices")).toBe("sc-a");
    expect(pickSourceCategory([...candidates].reverse(), "Vices")).toBe("sc-a");
    expect(pickSourceCategory([{ externalId: "sc-c", name: "Bar", count: 30 }, ...candidates], "Vices")).toBe(
      "sc-c",
    );
  });
});

describe("the names a category shows under its own", () => {
  it("are none when the one category of the source has its name", () => {
    expect(sourceNamesShown("Groceries", ["Groceries"])).toEqual([]);
    expect(sourceNamesShown("Groceries", [])).toEqual([]);
  });

  it("are all of them, in order, when there are several or one is called another way", () => {
    expect(sourceNamesShown("Vices", ["Tobacco", "Alcohol, tobacco"])).toEqual([
      "Alcohol, tobacco",
      "Tobacco",
    ]);
    expect(sourceNamesShown("Food", ["Groceries"])).toEqual(["Groceries"]);
  });
});
