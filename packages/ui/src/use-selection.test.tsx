import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSelection } from "./use-selection";

describe("useSelection", () => {
  it("toggles one id on and off", () => {
    const { result } = renderHook(() => useSelection(["a", "b", "c"]));
    act(() => result.current.toggle("b"));
    expect(result.current.selected).toEqual(["b"]);
    expect(result.current.has("b")).toBe(true);
    act(() => result.current.toggle("b"));
    expect(result.current.selected).toEqual([]);
  });

  it("selects the whole list, then clears it on a second toggle", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    act(() => result.current.toggle("a"));
    expect(result.current.all).toBe(false);
    act(() => result.current.toggleAll());
    expect(result.current.selected).toEqual(["a", "b"]);
    expect(result.current.all).toBe(true);
    act(() => result.current.toggleAll());
    expect(result.current.selected).toEqual([]);
  });

  it("an empty list is never all selected", () => {
    const { result } = renderHook(() => useSelection([]));
    expect(result.current.all).toBe(false);
  });

  it("clears", () => {
    const { result } = renderHook(() => useSelection(["a", "b"]));
    act(() => result.current.toggleAll());
    act(() => result.current.clear());
    expect(result.current.selected).toEqual([]);
  });

  it("keeps only the ids the list still shows, in the list's order", () => {
    const { result, rerender } = renderHook(({ ids }) => useSelection(ids), {
      initialProps: { ids: ["a", "b", "c"] },
    });
    act(() => result.current.toggle("c"));
    act(() => result.current.toggle("a"));
    expect(result.current.selected).toEqual(["a", "c"]);
    rerender({ ids: ["b", "c"] });
    expect(result.current.selected).toEqual(["c"]);
    expect(result.current.has("a")).toBe(false);
  });
});
