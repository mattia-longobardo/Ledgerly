import { describe, expect, it } from "vitest";
import {
  monthlyHistory,
  type MovementLike,
  platformInputSchema,
  platformStats,
  portfolioStats,
  valueOn,
} from "./rules";

const A = "platform-a";
const B = "platform-b";
const movements: MovementLike[] = [
  { platformId: A, kind: "deposit", amountCents: 100_000n, on: "2026-01-10" },
  { platformId: A, kind: "deposit", amountCents: 50_000n, on: "2026-02-10" },
  { platformId: A, kind: "withdrawal", amountCents: 30_000n, on: "2026-03-05" },
];

describe("valueOn", () => {
  it("is unknown once money went in and nobody has valued the platform", () => {
    expect(valueOn(movements, [], "2026-03-31")).toEqual({
      valueCents: null,
      valuedOn: null,
      estimated: false,
    });
  });

  it("is zero before anything happened", () => {
    expect(valueOn(movements, [], "2025-12-31").valueCents).toBe(0n);
  });

  it("takes the latest valuation, which already holds the movements of its own day", () => {
    const valuations = [
      { platformId: A, on: "2026-01-31", valueCents: 101_000n },
      { platformId: A, on: "2026-02-10", valueCents: 155_000n },
    ];
    expect(valueOn(movements, valuations, "2026-02-28")).toEqual({
      valueCents: 155_000n,
      valuedOn: "2026-02-10",
      estimated: false,
    });
  });

  it("moves the valuation by the flows after it, and says it is an estimate", () => {
    const valuations = [{ platformId: A, on: "2026-01-31", valueCents: 101_000n }];
    expect(valueOn(movements, valuations, "2026-03-31")).toEqual({
      valueCents: 121_000n,
      valuedOn: "2026-01-31",
      estimated: true,
    });
  });

  it("never goes below zero", () => {
    const valuations = [{ platformId: A, on: "2026-02-28", valueCents: 10_000n }];
    expect(valueOn(movements, valuations, "2026-03-31").valueCents).toBe(0n);
  });
});

describe("platformStats", () => {
  it("adds up deposits and withdrawals and measures the gain against what went in", () => {
    const stats = platformStats(
      movements,
      [{ platformId: A, on: "2026-03-31", valueCents: 150_000n }],
      "2026-04-01",
    );
    expect(stats).toMatchObject({
      depositedCents: 150_000n,
      withdrawnCents: 30_000n,
      netCents: 120_000n,
      valueCents: 150_000n,
      gainCents: 30_000n,
    });
    expect(stats.returnRate).toBeCloseTo(0.2);
  });

  it("counts what came out of a closed platform as its gain", () => {
    const closed: MovementLike[] = [
      { platformId: B, kind: "deposit", amountCents: 200_000n, on: "2026-06-11" },
      { platformId: B, kind: "withdrawal", amountCents: 240_158n, on: "2026-06-16" },
    ];
    const stats = platformStats(closed, [{ platformId: B, on: "2026-06-16", valueCents: 0n }], "2026-09-01");
    expect(stats.netCents).toBe(-40_158n);
    expect(stats.gainCents).toBe(40_158n);
  });

  it("has no gain and no return without a value", () => {
    const stats = platformStats(movements, [], "2026-04-01");
    expect(stats.gainCents).toBeNull();
    expect(stats.returnRate).toBeNull();
  });
});

describe("portfolioStats", () => {
  it("has no value while one platform has none, and says the total is partial", () => {
    const valued = platformStats(
      movements,
      [{ platformId: A, on: "2026-03-31", valueCents: 150_000n }],
      "2026-04-01",
    );
    const unvalued = platformStats(
      [{ platformId: B, kind: "deposit", amountCents: 10_000n, on: "2026-01-01" }],
      [],
      "2026-04-01",
    );
    const total = portfolioStats([valued, unvalued]);
    expect(total.depositedCents).toBe(160_000n);
    expect(total.valueCents).toBeNull();
    expect(total.partial).toBe(true);
    expect(portfolioStats([valued]).valueCents).toBe(150_000n);
  });

  it("dates the total by the platforms that still hold money, not by a closed one", () => {
    const open = platformStats(
      movements,
      [{ platformId: A, on: "2026-03-31", valueCents: 150_000n }],
      "2026-04-01",
    );
    const closed = platformStats(
      [{ platformId: B, kind: "deposit", amountCents: 10_000n, on: "2026-01-01" }],
      [{ platformId: B, on: "2026-01-15", valueCents: 0n }],
      "2026-04-01",
    );
    expect(portfolioStats([open, closed]).valuedOn).toBe("2026-03-31");
    expect(portfolioStats([closed]).valuedOn).toBe("2026-01-15");
  });
});

describe("monthlyHistory", () => {
  it("draws what is still invested each month, and the value only where it is known", () => {
    const history = monthlyHistory(
      [A],
      movements,
      [{ platformId: A, on: "2026-02-15", valueCents: 152_000n }],
      ["2025-12-01", "2026-01-01", "2026-02-01", "2026-03-01"],
    );
    expect(history.invested).toEqual([null, 100_000n, 150_000n, 120_000n]);
    expect(history.value).toEqual([null, null, 152_000n, 122_000n]);
  });
});

describe("platformInputSchema", () => {
  it("accepts a web address, adding the scheme a person leaves out", () => {
    expect(platformInputSchema.parse({ name: " eToro ", url: "www.etoro.com" })).toEqual({
      name: "eToro",
      url: "https://www.etoro.com",
    });
    expect(platformInputSchema.parse({ name: "Binance", url: "" }).url).toBeNull();
  });

  it("refuses anything that is not http(s)", () => {
    expect(() => platformInputSchema.parse({ name: "x", url: "javascript:alert(1)" })).toThrow();
    expect(() => platformInputSchema.parse({ name: "x", url: "ftp://example.com" })).toThrow();
  });
});
