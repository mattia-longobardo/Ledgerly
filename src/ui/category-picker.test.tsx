import { describe, expect, it } from "vitest";
import { searchCategories } from "./category-picker";

const items = [
  { id: null, name: "Uncategorised", color: null },
  { id: "casa", name: "Casa", color: "#1", depth: 0 as const },
  { id: "affitto", name: "Affitto", color: "#1", depth: 1 as const },
  { id: "spesa", name: "Spesa", color: "#1", depth: 1 as const },
  { id: "svago", name: "Svago", color: "#2", depth: 0 as const },
  { id: "caffe", name: "Caffè", color: "#2", depth: 1 as const },
];
const names = (query: string) => searchCategories(items, query).map((item) => item.name);

describe("searchCategories", () => {
  it("keeps everything for an empty search", () => {
    expect(names("  ")).toHaveLength(items.length);
  });

  it("finds a sub-category and keeps the group it sits under", () => {
    expect(names("spe")).toEqual(["Casa", "Spesa"]);
  });

  it("brings a matching group's sub-categories along", () => {
    expect(names("casa")).toEqual(["Casa", "Affitto", "Spesa"]);
  });

  it("ignores case and accents", () => {
    expect(names("CAFFE")).toEqual(["Svago", "Caffè"]);
  });

  it("answers nothing when nothing matches", () => {
    expect(names("zzz")).toEqual([]);
  });
});
