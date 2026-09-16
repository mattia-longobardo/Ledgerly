import { describe, expect, it } from "vitest";
import { DEFAULT_LIMIT, MAX_LIMIT, boundedLimit, escapeLike, shareOf } from "./queries";

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
