import { describe, expect, it } from "vitest";
import { ECB_FIRST_DAY, eurPerUnitOf, rangesToFetch } from "./rules";

describe("eurPerUnitOf", () => {
  it("turns 'units per euro' into 'euro per unit' at ten decimals", () => {
    expect(eurPerUnitOf(1.25)).toBe("0.8000000000");
    expect(eurPerUnitOf(0.83658)).toBe("1.1953429439");
    expect(eurPerUnitOf(1)).toBe("1.0000000000");
  });

  it("is null for a rate that cannot be one, or that rounds to zero", () => {
    expect(eurPerUnitOf(0)).toBeNull();
    expect(eurPerUnitOf(-1)).toBeNull();
    expect(eurPerUnitOf(Number.NaN)).toBeNull();
    expect(eurPerUnitOf(Number.POSITIVE_INFINITY)).toBeNull();
    expect(eurPerUnitOf(1e12)).toBeNull();
  });
});

describe("rangesToFetch", () => {
  const today = "2026-10-27";

  it("asks for nothing while there is no balance to convert", () => {
    expect(rangesToFetch({ firstBalanceOn: null, earliest: null, latest: null, today })).toEqual([]);
    expect(
      rangesToFetch({ firstBalanceOn: null, earliest: "2026-10-01", latest: "2026-10-20", today }),
    ).toEqual([]);
  });

  it("backfills an empty table from the first balance to today", () => {
    expect(rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: null, latest: null, today })).toEqual([
      { from: "2024-03-10", to: today },
    ]);
  });

  it("never asks for days before the first ECB rate, nor after today", () => {
    expect(rangesToFetch({ firstBalanceOn: "1990-01-01", earliest: null, latest: null, today })).toEqual([
      { from: ECB_FIRST_DAY, to: today },
    ]);
    expect(rangesToFetch({ firstBalanceOn: "2027-01-01", earliest: null, latest: null, today })).toEqual([
      { from: today, to: today },
    ]);
  });

  it("asks only for the days after the last stored one", () => {
    expect(
      rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: "2024-03-08", latest: "2026-10-23", today }),
    ).toEqual([{ from: "2026-10-24", to: today }]);
    expect(
      rangesToFetch({ firstBalanceOn: "2024-03-10", earliest: "2024-03-08", latest: today, today }),
    ).toEqual([]);
  });

  it("fills in the past when a balance older than the table appears", () => {
    expect(
      rangesToFetch({ firstBalanceOn: "2020-01-01", earliest: "2024-03-08", latest: today, today }),
    ).toEqual([{ from: "2020-01-01", to: "2024-03-07" }]);
  });
});
