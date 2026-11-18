import { describe, expect, it } from "vitest";
import { type MergeCategory, mergeProposals, pairKey, reviewGroups, type ReviewRow } from "./review-rules";

let next = 0;
function row(key: string, on: string, cents: bigint, suggested: string | null = null): ReviewRow {
  next += 1;
  return {
    id: `tx-${String(next).padStart(3, "0")}`,
    key,
    text: key.toUpperCase(),
    on,
    accountId: "acc",
    amountCents: cents,
    suggestedCategoryId: suggested,
    reason: suggested === null ? null : "similar",
    params: null,
  };
}

describe("the groups of To review", () => {
  it("puts together the movements with the same text and the same suggestion, with their sum", () => {
    const review = reviewGroups([
      row("mercato alfa", "2026-11-05", -3_890n, "c1"),
      row("mercato alfa", "2026-11-12", -5_420n, "c1"),
      row("bar epsilon", "2026-11-10", -450n),
      row("bar epsilon", "2026-11-11", -500n),
      row("bar epsilon", "2026-11-09", -400n),
    ]);
    expect(review.suggested).toHaveLength(1);
    expect(review.suggested[0]).toMatchObject({ count: 2, totalCents: -9_310n, suggestedCategoryId: "c1" });
    // The newest movement first, and its text is the group's.
    expect(review.suggested[0].rows.map((one) => one.on)).toEqual(["2026-11-12", "2026-11-05"]);
    expect(review.unsuggested[0]).toMatchObject({ count: 3, totalCents: -1_350n, suggestedCategoryId: null });
    expect(review.singles).toEqual([]);
  });

  it("keeps apart the same text with two different suggestions", () => {
    const review = reviewGroups([
      row("emporio phi", "2026-11-01", -100n, "c1"),
      row("emporio phi", "2026-11-02", -100n, "c1"),
      row("emporio phi", "2026-11-03", -100n, "c2"),
      row("emporio phi", "2026-11-04", -100n, "c2"),
    ]);
    expect(review.suggested.map((group) => group.suggestedCategoryId).sort()).toEqual(["c1", "c2"]);
  });

  it("leaves alone a movement with no similar one, and one with no text", () => {
    const review = reviewGroups([
      row("voli gimel", "2026-11-01", -12_000n, "c1"),
      row("", "2026-11-03", -100n),
      row("", "2026-11-02", -100n),
    ]);
    expect(review.suggested).toEqual([]);
    expect(review.unsuggested).toEqual([]);
    expect(review.singles.map((one) => one.on)).toEqual(["2026-11-03", "2026-11-02", "2026-11-01"]);
  });

  it("orders the groups by size, then by the most recent movement", () => {
    const review = reviewGroups([
      row("a", "2026-11-01", -1n),
      row("a", "2026-11-02", -1n),
      row("b", "2026-11-08", -1n),
      row("b", "2026-11-09", -1n),
      row("c", "2026-10-01", -1n),
      row("c", "2026-10-02", -1n),
      row("c", "2026-10-03", -1n),
    ]);
    expect(review.unsuggested.map((group) => group.text)).toEqual(["C", "B", "A"]);
  });
});

describe("the categories that look like the same one", () => {
  const category = (id: string, name: string, extra: Partial<MergeCategory> = {}): MergeCategory => ({
    id,
    name,
    type: "expense",
    parentId: null,
    fromSource: false,
    ...extra,
  });
  const names = (pairs: [MergeCategory, MergeCategory][]) => pairs.map(([a, b]) => `${a.name} + ${b.name}`);

  it("proposes two names made of the same words, and a name whose words are all in another", () => {
    const pairs = mergeProposals(
      [
        category("1", "Tobacco"),
        category("2", "Alcohol, tobacco"),
        category("3", "Bar e ristoranti"),
        category("4", "Ristoranti, bar"),
        category("5", "Rent"),
      ],
      new Set(),
    );
    expect(names(pairs)).toEqual(["Tobacco + Alcohol, tobacco", "Bar e ristoranti + Ristoranti, bar"]);
  });

  it("proposes nothing across kinds, between a group and its sub-category, or for a category of a source", () => {
    expect(
      mergeProposals(
        [
          category("1", "Refunds"),
          category("2", "Refunds", { type: "income" }),
          category("3", "Transport"),
          category("4", "Transport", { parentId: "3" }),
          category("5", "Groceries", { fromSource: true }),
          category("6", "Groceries"),
        ],
        new Set(),
      ),
    ).toEqual([]);
  });

  it("does not go by one short word inside a longer name", () => {
    expect(mergeProposals([category("1", "Bar"), category("2", "Bar e ristoranti")], new Set())).toEqual([]);
  });

  it("does not propose again a pair the person said is two things, whichever way round", () => {
    const all = [category("b", "Tobacco"), category("a", "Alcohol, tobacco")];
    expect(mergeProposals(all, new Set([pairKey("a", "b")]))).toEqual([]);
    expect(pairKey("a", "b")).toBe(pairKey("b", "a"));
  });
});
