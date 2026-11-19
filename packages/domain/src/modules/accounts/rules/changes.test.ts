import { describe, expect, it } from "vitest";
import { stepsOf, windowChangeOf } from "./changes";

describe("the changes of a chart", () => {
  it("gives each point its change from the one before, none for the first or next to an unknown", () => {
    expect(stepsOf([100n, 150n, null, 120n])).toEqual([
      { cents: null, fraction: null },
      { cents: 50n, fraction: 0.5 },
      { cents: null, fraction: null },
      { cents: null, fraction: null },
    ]);
    expect(stepsOf([])).toEqual([]);
  });

  it("gives the window's change from its first known value to its last", () => {
    expect(windowChangeOf([null, -200n, 50n, 100n])).toEqual({ cents: 300n, fraction: 1.5 });
    expect(windowChangeOf([100n, null])).toEqual({ cents: null, fraction: null });
    expect(windowChangeOf([0n, 10n])).toEqual({ cents: 10n, fraction: null });
    expect(windowChangeOf([])).toEqual({ cents: null, fraction: null });
  });
});
