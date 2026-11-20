import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CategoryPicker, searchCategories } from "./category-picker";

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

describe("CategoryPicker, multiple", () => {
  const categories = [
    { id: "casa", name: "Casa", color: "#1", count: 3 },
    { id: "svago", name: "Svago", color: "#2", count: 1 },
  ];

  function renderMultiple(selectedIds: (string | null)[]) {
    const onPick = vi.fn();
    const onClear = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CategoryPicker
        categories={categories}
        multiple={{ selectedIds, title: "Categories", clearLabel: "Clear", onClear }}
        uncategorisedLabel="To categorise"
        uncategorisedCount={7}
        open
        onOpenChange={onOpenChange}
        onPick={onPick}
        searchLabel="Search"
        noMatchLabel="No match"
        triggerLabel="2 categories"
        triggerClassName=""
      >
        2 categories
      </CategoryPicker>,
    );
    return { onPick, onClear, onOpenChange };
  }

  it("ticks every selected option, Uncategorised included, and lists it last", () => {
    renderMultiple(["svago", null]);
    expect(screen.getByRole("listbox")).toHaveAttribute("aria-multiselectable", "true");
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Casa3", "Svago1", "To categorise7"]);
    expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual(["false", "true", "true"]);
  });

  it("toggles one option and stays open", async () => {
    const { onPick, onOpenChange } = renderMultiple([]);
    await userEvent.click(screen.getByRole("option", { name: /Casa/ }));
    expect(onPick).toHaveBeenCalledWith("casa");
    await userEvent.click(screen.getByRole("option", { name: /To categorise/ }));
    expect(onPick).toHaveBeenLastCalledWith(null);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("clears the selection", async () => {
    const { onClear } = renderMultiple(["casa"]);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledOnce();
  });
});
