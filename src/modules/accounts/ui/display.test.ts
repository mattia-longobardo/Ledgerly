import { describe, expect, it } from "vitest";
import { monthsBetween } from "@/platform/dates";
import { axisLabels, changeBetween, colorFor, monthLabels, PALETTE, shareOf, since } from "./display";

describe("changeBetween", () => {
  it("is unknown when either end is unknown, never zero", () => {
    expect(changeBetween(null, 100n)).toEqual({ cents: null, fraction: null });
    expect(changeBetween(100n, null)).toEqual({ cents: null, fraction: null });
  });

  it("measures the change against the earlier value", () => {
    expect(changeBetween(150n, 100n)).toEqual({ cents: 50n, fraction: 0.5 });
    expect(changeBetween(50n, 100n)).toEqual({ cents: -50n, fraction: -0.5 });
  });

  it("gives no percentage when the earlier value was zero", () => {
    expect(changeBetween(50n, 0n)).toEqual({ cents: 50n, fraction: null });
  });

  it("measures a rise from a negative balance as a rise", () => {
    expect(changeBetween(-50n, -100n)).toEqual({ cents: 50n, fraction: 0.5 });
  });
});

describe("shareOf", () => {
  it("is null rather than a misleading zero when the total is unknown or empty", () => {
    expect(shareOf(10n, null)).toBeNull();
    expect(shareOf(10n, 0n)).toBeNull();
    expect(shareOf(null, 100n)).toBeNull();
  });

  it("is the fraction of the total", () => {
    expect(shareOf(25n, 100n)).toBe(0.25);
  });
});

describe("colorFor", () => {
  it("prefers the account's own colour and falls back to the palette in order", () => {
    expect(colorFor({ color: "#123456" }, 3)).toBe("#123456");
    expect(colorFor({ color: null }, 0)).toBe(PALETTE[0]);
    expect(colorFor({ color: null }, PALETTE.length)).toBe(PALETTE[0]);
  });
});

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

describe("since", () => {
  const now = new Date("2026-09-16T12:00:00Z");
  const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  it("has a word for an account that never synced", () => {
    expect(since(null, now)).toEqual({ unit: "never" });
  });

  it("counts minutes, then hours, then days", () => {
    expect(since(ago(5), now)).toEqual({ unit: "minutes", count: 5 });
    expect(since(ago(90), now)).toEqual({ unit: "hours", count: 2 });
    expect(since(ago(60 * 72), now)).toEqual({ unit: "days", count: 3 });
  });

  it("never counts backwards when a reading is slightly in the future", () => {
    expect(since(new Date(now.getTime() + 60_000), now)).toEqual({ unit: "minutes", count: 0 });
  });
});
