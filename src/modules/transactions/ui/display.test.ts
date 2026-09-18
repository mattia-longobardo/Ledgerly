import { describe, expect, it } from "vitest";
import { badgesOf, type BadgeSource, calendarCells, categoryBreakdown, rangeLabel } from "./display";

const PLAIN: BadgeSource = {
  hiddenAt: null,
  removedUpstreamAt: null,
  locallyEdited: [],
  type: "expense",
  transferGroupId: null,
  state: "cleared",
};

describe("badgesOf", () => {
  it("says nothing about an ordinary movement", () => {
    expect(badgesOf(PLAIN)).toEqual([]);
  });

  it("tells a row the user hid from one the provider stopped sending", () => {
    expect(badgesOf({ ...PLAIN, hiddenAt: new Date() })).toEqual(["hidden"]);
    expect(badgesOf({ ...PLAIN, removedUpstreamAt: new Date() })).toEqual(["removedUpstream"]);
  });

  it("marks a local edit, a transfer and a pending movement", () => {
    expect(badgesOf({ ...PLAIN, locallyEdited: ["categoryId"] })).toEqual(["edited"]);
    expect(badgesOf({ ...PLAIN, type: "transfer" })).toEqual(["transfer"]);
    expect(badgesOf({ ...PLAIN, transferGroupId: "t1" })).toEqual(["transfer"]);
    expect(badgesOf({ ...PLAIN, state: "pending" })).toEqual(["pending"]);
  });

  it("keeps every marker a row happens to carry, in one order", () => {
    expect(
      badgesOf({
        ...PLAIN,
        hiddenAt: new Date(),
        removedUpstreamAt: new Date(),
        locallyEdited: ["note"],
        type: "transfer",
        state: "pending",
      }),
    ).toEqual(["hidden", "removedUpstream", "edited", "transfer", "pending"]);
  });
});

describe("categoryBreakdown", () => {
  const { bars, totalCents } = categoryBreakdown([
    { id: "a", name: "Groceries", color: "#1", cents: -4000n },
    { id: "b", name: "Rent", color: "#2", cents: -6000n },
    { id: "c", name: "Nothing", color: "#3", cents: 0n },
  ]);

  it("puts the biggest first and leaves out what moved nothing", () => {
    expect(bars.map((bar) => bar.id)).toEqual(["b", "a"]);
  });

  it("measures the share against the whole and the bar against the biggest", () => {
    expect(bars[0]).toMatchObject({ share: 0.6, width: 1 });
    expect(bars[1]).toMatchObject({ share: 0.4 });
    expect(bars[1].width).toBeCloseTo(0.666, 2);
  });

  it("totals the very rows it returns, in cents", () => {
    expect(totalCents).toBe(10000n);
  });

  it("compares sizes and not signs, so an income slice is a slice", () => {
    const mixed = categoryBreakdown([
      { id: "in", name: "Salary", color: "#1", cents: 300000n },
      { id: "out", name: "Rent", color: "#2", cents: -100000n },
    ]);
    expect(mixed.bars.map((bar) => bar.id)).toEqual(["in", "out"]);
    expect(mixed.bars[0].share).toBe(0.75);
  });

  it("heads a card whose rows cancel out with what those rows moved, not with zero", () => {
    // The reviewer's September: a salary of +2.500 and a rent of −2.500. A signed sum would say
    // "0,00 €" over two rows of 2.500, which is the header contradicting its own list.
    const cancelling = categoryBreakdown([
      { id: "in", name: "Stipendio", color: "#1", cents: 250000n },
      { id: "out", name: "Affitto", color: "#2", cents: -250000n },
    ]);
    expect(cancelling.totalCents).toBe(500000n);
    expect(cancelling.bars.map((bar) => bar.share)).toEqual([0.5, 0.5]);
  });

  it("gives no shares at all when the slices cancel out", () => {
    const zero = categoryBreakdown([
      { id: "in", name: "In", color: "#1", cents: 0n },
      { id: "out", name: "Out", color: "#2", cents: 0n },
    ]);
    expect(zero.bars).toEqual([]);
    expect(zero.totalCents).toBe(0n);
  });
});

describe("rangeLabel", () => {
  it("names a single month and spells anything else out", () => {
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-30" }, "en")).toBe("September 2026");
    expect(rangeLabel({ from: "2026-07-01", to: "2026-09-30" }, "en")).toBe("1 Jul 2026 – 30 Sep 2026");
    expect(rangeLabel({ from: "2026-09-01", to: "2026-09-30" }, "it")).toBe("settembre 2026");
  });
});

describe("calendarCells", () => {
  it("pads the grid to the Monday the month starts after", () => {
    // 1 September 2026 is a Tuesday: one blank before it.
    const cells = calendarCells("2026-09-01");
    expect(cells.length).toBe(30 + 1);
    expect(cells[0]).toBeNull();
    expect(cells[1]).toBe("2026-09-01");
    expect(cells.at(-1)).toBe("2026-09-30");
  });

  it("needs no padding for a month that starts on a Monday", () => {
    // 1 June 2026 is a Monday.
    expect(calendarCells("2026-06-01")[0]).toBe("2026-06-01");
  });

  it("counts the days of February in a leap year", () => {
    expect(calendarCells("2028-02-01").filter((day) => day !== null).length).toBe(29);
  });
});
