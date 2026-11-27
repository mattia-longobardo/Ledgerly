import { describe, expect, it } from "vitest";
import { basketProblem, weightBp } from "./plan-words";

const row = (weight: string, instrumentId: string | null, assetId: string | null = null) => ({
  weight,
  instrumentId,
  assetId,
});

describe("the form's check of a basket (PERS-681 §7)", () => {
  it("reads a percentage as typed in basis points", () => {
    expect(weightBp("33,33", "it-IT")).toBe(3333);
    expect(weightBp("50", "en-US")).toBe(5000);
    expect(weightBp("", "it-IT")).toBeNull();
    expect(weightBp("abc", "it-IT")).toBeNull();
    expect(weightBp("0", "it-IT")).toBeNull();
  });

  it("refuses percentages that do not make 100, a repeated instrument, none or more than 10", () => {
    expect(basketProblem([row("60", "a"), row("30", "b")], "it-IT")).toBe("sum");
    expect(basketProblem([row("66,67", "a"), row("33,33", "b")], "it-IT")).toBeNull();
    expect(basketProblem([row("50", "a"), row("50", "a")], "it-IT")).toBe("repeated");
    // An asset of the plan and the same instrument picked again are one instrument.
    expect(basketProblem([row("50", "a", "x"), row("50", "a")], "it-IT")).toBe("repeated");
    expect(basketProblem([], "it-IT")).toBe("empty");
    expect(
      basketProblem(
        Array.from({ length: 11 }, (_, i) => row("1", String(i))),
        "it-IT",
      ),
    ).toBe("tooMany");
  });
});
