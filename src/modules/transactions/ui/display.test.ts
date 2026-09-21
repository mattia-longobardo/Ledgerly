import { describe, expect, it } from "vitest";
import { PALETTE } from "@/modules/accounts/ui/display";
import {
  amountToneOf,
  badgesOf,
  type BadgeSource,
  categoryBreakdown,
  categoryColors,
  groupedBreakdown,
  rangeLabel,
  spendingLayers,
} from "./display";

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
    expect(badgesOf({ ...PLAIN, type: "transfer", transferGroupId: "t1" })).toEqual(["transfer"]);
    expect(badgesOf({ ...PLAIN, transferGroupId: "t1" })).toEqual(["transfer"]);
    expect(badgesOf({ ...PLAIN, state: "pending" })).toEqual(["pending"]);
  });

  it("tells a giroconto with no other leg from a paired one (F2.5)", () => {
    expect(badgesOf({ ...PLAIN, type: "transfer" })).toEqual(["unpaired"]);
    expect(badgesOf({ ...PLAIN, type: "transfer", transferGroupId: "t1" })).toEqual(["transfer"]);
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
    ).toEqual(["hidden", "removedUpstream", "edited", "unpaired", "pending"]);
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

describe("groupedBreakdown", () => {
  const slice = (
    id: string,
    name: string,
    cents: bigint,
    parent: { id: string; name: string } | null = null,
  ) => ({
    id,
    name,
    color: `#${id}`,
    cents,
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? null,
    parentColor: parent ? `#${parent.id}` : null,
  });
  const casa = { id: "casa", name: "Casa" };

  it("gathers sub-categories under their group, biggest group first (F2.5)", () => {
    const { groups, totalCents } = groupedBreakdown([
      slice("spesa", "Spesa", -30000n, casa),
      slice("affitto", "Affitto", -70000n, casa),
      slice("svago", "Svago", -20000n),
    ]);
    expect(totalCents).toBe(120000n);
    expect(groups.map((group) => [group.name, group.cents, group.color])).toEqual([
      ["Casa", -100000n, "#casa"],
      ["Svago", -20000n, "#svago"],
    ]);
    expect(groups[0].share).toBeCloseTo(100000 / 120000);
    // Within a group, shares are of the group.
    expect(groups[0].children.map((child) => [child.name, child.share])).toEqual([
      ["Affitto", 0.7],
      ["Spesa", 0.3],
    ]);
    expect(groups[1].children).toEqual([]);
  });

  it("counts what was filed on the group itself as one of its rows, under the group's name", () => {
    const { groups } = groupedBreakdown([
      slice("casa", "Casa", -5000n),
      slice("spesa", "Spesa", -15000n, casa),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].cents).toBe(-20000n);
    expect(groups[0].children.map((child) => [child.id, child.name])).toEqual([
      ["spesa", "Spesa"],
      ["casa", "Casa"],
    ]);
  });

  it("leaves out a group whose rows cancel out, like the flat card does", () => {
    expect(groupedBreakdown([slice("a", "A", 5000n, casa), slice("b", "B", -5000n, casa)]).groups).toEqual(
      [],
    );
  });
});

describe("amountToneOf", () => {
  it("paints spending red and income green", () => {
    expect(amountToneOf({ type: "expense", amountCents: -1_299n })).toBe("neg");
    expect(amountToneOf({ type: "income", amountCents: 210_000n })).toBe("pos");
  });

  it("paints a giroconto grey whichever way it goes: it is neither (spec §7.2)", () => {
    expect(amountToneOf({ type: "transfer", amountCents: -50_000n })).toBe("muted");
    expect(amountToneOf({ type: "transfer", amountCents: 50_000n })).toBe("muted");
  });
});

describe("categoryColors", () => {
  const category = (id: string, color: string | null, parentId: string | null = null) => ({
    id,
    color,
    parentId,
  });

  it("gives every sub-category its group's colour, whatever colour it has of its own", () => {
    const colors = categoryColors([
      category("casa", "#2563eb"),
      category("spesa", "#dc2626", "casa"),
      category("affitto", null, "casa"),
    ]);
    expect(colors.get("spesa")).toBe("#2563eb");
    expect(colors.get("affitto")).toBe("#2563eb");
  });

  it("gives a group without a colour one from the palette, counted by group so siblings never shift it", () => {
    const colors = categoryColors([
      category("casa", null),
      category("spesa", null, "casa"),
      category("svago", null),
      category("abbonamenti", null, "svago"),
    ]);
    expect(colors.get("casa")).toBe(PALETTE[0]);
    expect(colors.get("spesa")).toBe(PALETTE[0]);
    expect(colors.get("svago")).toBe(PALETTE[1]);
    expect(colors.get("abbonamenti")).toBe(PALETTE[1]);
  });

  it("keeps its own colour for a sub-category whose group is not in the list", () => {
    expect(categoryColors([category("orphan", "#10b981", "archived-group")]).get("orphan")).toBe("#10b981");
  });
});

describe("spendingLayers", () => {
  const buckets = ["2026-09-01", "2026-09-02", "2026-09-03"];

  it("gives each group a value for every day, zero where it spent nothing, the biggest spender first", () => {
    const { groups, totals } = spendingLayers(
      [
        { bucket: "2026-09-01", groupId: "casa", cents: 1_000n },
        { bucket: "2026-09-03", groupId: "casa", cents: 500n },
        { bucket: "2026-09-02", groupId: "svago", cents: 4_000n },
        { bucket: "2026-09-02", groupId: null, cents: 200n },
      ],
      buckets,
    );
    expect(groups).toEqual([
      { id: "svago", values: [0n, 4_000n, 0n], total: 4_000n },
      { id: "casa", values: [1_000n, 0n, 500n], total: 1_500n },
      { id: null, values: [0n, 200n, 0n], total: 200n },
    ]);
    expect(totals).toEqual([1_000n, 4_200n, 500n]);
  });

  it("ignores a point outside the buckets and answers zeros for a quiet range", () => {
    expect(spendingLayers([{ bucket: "2026-08-31", groupId: "casa", cents: 1n }], buckets)).toEqual({
      groups: [],
      totals: [0n, 0n, 0n],
    });
  });
});
