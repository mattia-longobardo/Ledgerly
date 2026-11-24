import { describe, expect, it } from "vitest";
import { thresholdsFor, whyNoSuggestionThreshold, whyNoThresholds } from "./thresholds";

// Why a threshold could not form (R6, the measure's diagnosis): the same walk as `thresholdsFor`.
const trials = (count: number, confidence: number, rightShare: number) =>
  Array.from({ length: count }, (_, index) => ({
    confidence: confidence - index / 10_000,
    correct: index % 10 < rightShare * 10,
  }));

describe("why a threshold is missing", () => {
  it("is the support with fewer predictions than a band", () => {
    expect(whyNoThresholds(trials(10, 0.9, 1))).toEqual({ automatic: "support", suggestion: "support" });
    expect(whyNoSuggestionThreshold([])).toBe("support");
  });

  it("is the floor when even the surest predictions prefer a category by too little", () => {
    expect(whyNoThresholds(trials(40, 0.3, 1)).automatic).toBe("floor");
  });

  it("is the precision when the surest band is wrong too often", () => {
    expect(whyNoThresholds(trials(40, 0.9, 0.5))).toEqual({
      automatic: "precision",
      suggestion: "precision",
    });
  });

  it("drops a suggestion that would not be under the automatic threshold, and names it", () => {
    const perfect = trials(40, 0.9, 1);
    expect(thresholdsFor(perfect).suggestion).toBeNull();
    expect(whyNoThresholds(perfect)).toEqual({ automatic: null, suggestion: "aboveAutomatic" });
  });

  it("is nothing where the threshold is there", () => {
    expect(whyNoSuggestionThreshold(trials(40, 0.9, 0.9))).toBeNull();
  });
});
