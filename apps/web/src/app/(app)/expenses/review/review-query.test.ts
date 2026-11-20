import { describe, expect, it } from "vitest";
import { parseReviewQuery, reviewParams } from "./review-query";

const TODAY = "2026-11-20";
const A = "11111111-1111-4111-8111-111111111111";

describe("parseReviewQuery", () => {
  it("opens on «All», with no window and no offset", () => {
    const query = parseReviewQuery({ off: "3" }, TODAY);
    expect(query).toMatchObject({ preset: "all", offset: 0, window: null, custom: null, guided: false });
    expect(reviewParams(query, [])).toEqual({
      preset: undefined,
      from: undefined,
      to: undefined,
      off: undefined,
      acc: undefined,
      guide: undefined,
      bank: undefined,
    });
  });

  it("moves a preset back by its own length", () => {
    const query = parseReviewQuery({ preset: "thisMonth", off: "1" }, TODAY);
    expect(query.window).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(reviewParams(query, []).off).toBe("1");
  });

  it("lets the days of another page win over a preset, and drops days in the wrong order", () => {
    expect(parseReviewQuery({ preset: "ytd", from: "2026-01-01", to: "2026-01-31" }, TODAY)).toMatchObject({
      preset: null,
      window: { from: "2026-01-01", to: "2026-01-31" },
    });
    expect(parseReviewQuery({ from: "2026-02-01", to: "2026-01-01" }, TODAY).preset).toBe("all");
  });

  it("keeps only accounts shaped as ids, and the guided review's bank only when guided", () => {
    const query = parseReviewQuery({ acc: `${A},nope`, guide: "1", bank: "Zeta Bank", step: "done" }, TODAY);
    expect(query).toMatchObject({ accounts: [A], guided: true, bank: "Zeta Bank", step: "done" });
    expect(reviewParams(query, [A])).toMatchObject({ acc: A, guide: "1", bank: "Zeta Bank" });
    expect(reviewParams(parseReviewQuery({ bank: "Zeta Bank" }, TODAY), []).bank).toBeUndefined();
  });
});
