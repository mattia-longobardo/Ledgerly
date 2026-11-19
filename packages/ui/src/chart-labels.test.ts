import { describe, expect, it } from "vitest";
import { monthsBetween } from "@ledgerly/format/dates";
import { axisLabels, dayLabels, monthLabels, symmetricAxisLabels } from "./chart-labels";

describe("axisLabels", () => {
  it("runs from the highest value down to the lowest", () => {
    const labels = axisLabels([0n, 500_00n, 1000_00n], "en-US");
    expect(labels).toHaveLength(4);
    expect(labels[0]).toContain("1,000");
    expect(labels[3]).toContain("0");
  });

  it("still answers for a series with nothing in it", () => {
    expect(axisLabels([null, null], "en-US")).toHaveLength(4);
  });
});

describe("monthLabels", () => {
  it("keeps every month when there are few enough", () => {
    expect(monthLabels(monthsBetween("2026-01-01", "2026-03-01"), "en")).toEqual([
      "Jan 26",
      "Feb 26",
      "Mar 26",
    ]);
  });

  it("spreads the labels out, always keeping the first and the last", () => {
    const months = monthsBetween("2025-01-01", "2026-12-01");
    const labels = monthLabels(months, "en", 5);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe("Jan 25");
    expect(labels[4]).toBe("Dec 26");
  });
});

describe("dayLabels", () => {
  it("names a few days evenly spread, the first and the last among them (F2.5)", () => {
    const days = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
    const labels = dayLabels(days, "en", 5);
    expect(labels).toHaveLength(5);
    expect(labels[0]).toBe("01 Sep");
    expect(labels[4]).toBe("30 Sep");
    expect(dayLabels(["2026-09-01", "2026-09-02"], "en")).toEqual(["01 Sep", "02 Sep"]);
  });
});

describe("symmetricAxisLabels", () => {
  it("puts zero in the middle, where the bars' baseline is, and the largest change at either end", () => {
    expect(
      symmetricAxisLabels([767_900n, -233_300n, null], "it-IT").map((label) => label.replace(/\s/g, " ")),
    ).toEqual(["7.679 €", "3.840 €", "0 €", "−3.840 €", "−7.679 €"]);
  });
});
