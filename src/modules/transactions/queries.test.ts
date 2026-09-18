import { describe, expect, it } from "vitest";
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  boundedLimit,
  escapeLike,
  monthGroups,
  shareOf,
  type MonthTotal,
  type TransactionRow,
} from "./queries";

describe("boundedLimit", () => {
  it("falls back to the default when no page size is asked for", () => {
    expect(boundedLimit()).toBe(DEFAULT_LIMIT);
    expect(boundedLimit(Number.NaN)).toBe(DEFAULT_LIMIT);
  });

  it("keeps a sensible page size and refuses to hand out the whole table", () => {
    expect(boundedLimit(25)).toBe(25);
    expect(boundedLimit(0)).toBe(1);
    expect(boundedLimit(-10)).toBe(1);
    expect(boundedLimit(10_000)).toBe(MAX_LIMIT);
    expect(boundedLimit(25.7)).toBe(25);
  });
});

describe("escapeLike", () => {
  it("leaves an ordinary term alone", () => {
    expect(escapeLike("Esselunga")).toBe("Esselunga");
  });

  it("makes the wildcards a person typed literal characters", () => {
    expect(escapeLike("100%")).toBe("100\\%");
    expect(escapeLike("a_b")).toBe("a\\_b");
    expect(escapeLike("back\\slash")).toBe("back\\\\slash");
  });
});

describe("shareOf", () => {
  it("is a percentage with one decimal", () => {
    expect(shareOf(-2_500n, 10_000n)).toBe(25);
    expect(shareOf(3_333n, 10_000n)).toBe(33.3);
  });

  it("answers zero rather than dividing by nothing", () => {
    expect(shareOf(0n, 0n)).toBe(0);
    expect(shareOf(1_000n, 0n)).toBe(0);
  });

  it("ignores the sign on both sides: a card of expenses still adds up to 100%", () => {
    expect(shareOf(-4_000n, -10_000n)).toBe(40);
    expect(shareOf(-6_000n, -10_000n)).toBe(60);
  });
});

/** Only the day and the amount matter here; the rest is what the table happens to also show. */
function row(on: CivilDate, amountCents: Cents, id = on + amountCents): TransactionRow {
  return {
    id,
    accountId: "account-1",
    accountName: "ING Conto Arancio",
    occurredAt: new Date(`${on}T09:00:00Z`),
    on,
    amountCents,
    currency: "EUR",
    type: "expense",
    state: "cleared",
    categoryId: null,
    categoryName: null,
    categoryColor: null,
    payee: "Esselunga",
    note: null,
    labels: [],
    transferGroupId: null,
    hiddenAt: null,
    removedUpstreamAt: null,
    locallyEdited: [],
    hidden: false,
    edited: false,
  };
}

describe("monthGroups", () => {
  const totals: MonthTotal[] = [
    { month: "2026-12-01", count: 48, totalCents: -180_000n },
    { month: "2026-01-01", count: 132, totalCents: -298_000n },
  ];

  it("takes each header's count and total from the range, never from the page (review B1)", () => {
    // The `limit` boundary: the page carries the whole of December and the last 12 movements of
    // January. Summing the page made January's header read −340,00 € against a real −2.980,00 €.
    const december = [row("2026-12-20", -100_000n), row("2026-12-21", -80_000n)];
    const january = Array.from({ length: 12 }, (_, index) => row("2026-01-28", -2_000n, `jan-${index}`));

    const groups = monthGroups([...december, ...january], totals);

    expect(groups.map((group) => group.month)).toEqual(["2026-12-01", "2026-01-01"]);
    expect(groups[1]).toMatchObject({ count: 132, totalCents: -298_000n });
    expect(groups[1].rows).toHaveLength(12);
    expect(groups[0]).toMatchObject({ count: 48, totalCents: -180_000n });
    expect(groups[0].rows).toHaveLength(2);
  });

  it("counts nothing for a month the totals leave out, rather than summing its rows", () => {
    // What "Show hidden" puts on screen: the rows are there, the totals of §7.2 exclude them.
    const groups = monthGroups([row("2026-11-03", -5_000n)], totals);
    expect(groups).toEqual([
      {
        month: "2026-11-01",
        count: 0,
        totalCents: 0n,
        rows: [expect.objectContaining({ on: "2026-11-03" })],
      },
    ]);
  });

  it("gives a month one header however the rows are ordered", () => {
    const groups = monthGroups(
      [row("2026-12-20", -100_000n), row("2026-01-28", -2_000n), row("2026-12-02", -80_000n)],
      totals,
    );
    expect(groups.map((group) => group.month)).toEqual(["2026-12-01", "2026-01-01"]);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].count).toBe(48);
  });

  it("answers with nothing for an empty page", () => {
    expect(monthGroups([], totals)).toEqual([]);
  });
});
