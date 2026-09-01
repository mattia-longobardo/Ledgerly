import { describe, expect, it } from "vitest";
import { NET_WORTH_STALENESS_MS, type MonthPoint } from "@/lib/contracts";
import {
  contributingKeys,
  missingKeys,
  netWorth,
  oldestCapture,
  sumBalances,
  sumSeries,
  type NetWorthContributor,
} from "./networth";

const NOW = new Date("2026-09-01T12:00:00Z");

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

function points(...pairs: Array<[string, number | null]>): MonthPoint[] {
  return pairs.map(([month, value]) => ({ month, value }));
}

function account(
  key: string,
  balance: string | null,
  opts: { capturedAt?: Date | null; points?: MonthPoint[] } = {},
): NetWorthContributor {
  return {
    key,
    balance,
    capturedAt: opts.capturedAt === undefined ? NOW : opts.capturedAt,
    points: opts.points ?? [],
  };
}

describe("sumBalances", () => {
  it("sums the real Allocation figures without float drift", () => {
    // The live 2026-08 Allocation row. Teable's TOTAL cell reads 21 494,35
    // because its formula is ING+Buddy Bank+Mediolanum+IsyBank+EToro+Binance+
    // Fideuram+Revolut — Fondo Cometa is not a term in it, so the old hero was
    // permanently missing the pension fund on top of everything else.
    expect(
      sumBalances([
        account("ing", "6955.46"),
        account("buddy_bank", "820.00"),
        account("isybank", "441.51"),
        account("mediolanum", "8393.13"),
        account("cometa", "2228.13"),
        account("fideuram", "4884.25"),
      ]),
    ).toBe("23722.48");
  });

  it("treats a missing account as a gap, not a zero", () => {
    expect(sumBalances([account("ing", "100.00"), account("etoro", null)])).toBe("100.00");
  });

  it("answers unknown — never 0,00 — when nothing is known at all", () => {
    expect(sumBalances([account("ing", null), account("etoro", null)])).toBeNull();
    expect(sumBalances([])).toBeNull();
  });

  it("keeps a genuine zero balance as a contribution", () => {
    expect(sumBalances([account("ing", "0.00"), account("etoro", null)])).toBe("0.00");
  });
});

describe("contributingKeys / missingKeys", () => {
  it("splits the contributors by whether they had a value", () => {
    const list = [account("ing", "1.00"), account("etoro", null), account("binance", "2.50")];
    expect(contributingKeys(list)).toEqual(["ing", "binance"]);
    expect(missingKeys(list)).toEqual(["etoro"]);
  });
});

describe("oldestCapture", () => {
  it("ignores accounts that contributed nothing", () => {
    const old = new Date("2026-01-01T00:00:00Z");
    expect(
      oldestCapture([
        account("ing", "1.00", { capturedAt: NOW }),
        // No value: its ancient stamp must not drag the total's age down.
        account("etoro", null, { capturedAt: old }),
      ]),
    ).toEqual(NOW);
  });

  it("returns the oldest contributing stamp", () => {
    const older = new Date("2026-08-30T00:00:00Z");
    expect(
      oldestCapture([account("ing", "1.00"), account("binance", "2.00", { capturedAt: older })]),
    ).toEqual(older);
  });

  it("is null when nothing contributed", () => {
    expect(oldestCapture([account("ing", null)])).toBeNull();
    expect(oldestCapture([])).toBeNull();
  });
});

describe("sumSeries", () => {
  it("sums month by month on one continuous axis", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100], ["2026-02-01", 110]) }),
      account("binance", "0", { points: points(["2026-01-01", 10], ["2026-02-01", 20]) }),
    ]);
    expect(series).toEqual(points(["2026-01-01", 110], ["2026-02-01", 130]));
  });

  it("carries an account forward across a month it was not refreshed in", () => {
    // The whole point: net worth must not dip because EToro was not updated.
    const series = sumSeries([
      account("ing", "0", {
        points: points(["2026-01-01", 100], ["2026-02-01", 100], ["2026-03-01", 100]),
      }),
      account("etoro", "0", { points: points(["2026-01-01", 50], ["2026-03-01", 60]) }),
    ]);
    expect(series).toEqual(
      points(["2026-01-01", 150], ["2026-02-01", 150], ["2026-03-01", 160]),
    );
  });

  it("carries the last known value forward past the end of an account's data", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100], ["2026-02-01", 200]) }),
      // Mediolanum stopped being updated in January.
      account("mediolanum", "0", { points: points(["2026-01-01", 9]) }),
    ]);
    expect(series).toEqual(points(["2026-01-01", 109], ["2026-02-01", 209]));
  });

  it("never carries a value backwards before an account's first observation", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100], ["2026-02-01", 100]) }),
      // Binance only starts existing in February.
      account("binance", "0", { points: points(["2026-02-01", 40]) }),
    ]);
    expect(series).toEqual(points(["2026-01-01", 100], ["2026-02-01", 140]));
  });

  it("skips blank cells rather than reading them as zero", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100], ["2026-02-01", null]) }),
      account("binance", "0", { points: points(["2026-01-01", 5], ["2026-02-01", 7]) }),
    ]);
    // February carries ING's January 100 forward instead of dropping to 7.
    expect(series).toEqual(points(["2026-01-01", 105], ["2026-02-01", 107]));
  });

  it("fills gaps in the middle of the axis that no account observed", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100], ["2026-04-01", 130]) }),
    ]);
    expect(series).toEqual(
      points(
        ["2026-01-01", 100],
        ["2026-02-01", 100],
        ["2026-03-01", 100],
        ["2026-04-01", 130],
      ),
    );
  });

  it("ignores an account with no history at all", () => {
    const series = sumSeries([
      account("ing", "0", { points: points(["2026-01-01", 100]) }),
      account("etoro", "0", { points: [] }),
      account("isybank", "0", { points: points(["2026-01-01", null]) }),
    ]);
    expect(series).toEqual(points(["2026-01-01", 100]));
  });

  it("returns an empty series when nothing was ever observed", () => {
    expect(sumSeries([])).toEqual([]);
    expect(sumSeries([account("ing", "0", { points: points(["2026-01-01", null]) })])).toEqual([]);
  });

  it("accepts full ISO dates as month keys", () => {
    const series = sumSeries([account("ing", "0", { points: points(["2026-01-17", 100]) })]);
    expect(series).toEqual(points(["2026-01-01", 100]));
  });

  it("sums in cents, so repeated decimals do not drift", () => {
    const series = sumSeries([
      account("a", "0", { points: points(["2026-01-01", 0.1]) }),
      account("b", "0", { points: points(["2026-01-01", 0.2]) }),
    ]);
    expect(series[0]?.value).toBe(0.3);
  });
});

describe("netWorth", () => {
  const contributors = [
    account("ing", "6955.46", { points: points(["2026-08-01", 6955.46]) }),
    account("binance", "250.00", { points: points(["2026-08-01", 250]) }),
  ];

  it("agrees with its own chart: the scalar is the last point of the series", () => {
    const result = netWorth(contributors, { now: NOW });
    expect(result.balance).toBe("7205.46");
    expect(result.points.at(-1)?.value).toBe(7205.46);
  });

  it("judges the whole total against one explicit budget", () => {
    // 20 hours old: far past Teable's 1 h display budget, but the hero is not
    // a Teable figure — it is a sum, and its budget is the slowest contributor's.
    const stamp = ago(20 * 60 * 60 * 1000);
    const fresh = netWorth([account("ing", "1.00", { capturedAt: stamp })], { now: NOW });
    expect(fresh.stale).toBe(false);
    expect(fresh.capturedAt).toEqual(stamp);

    const past = netWorth(
      [account("ing", "1.00", { capturedAt: ago(NET_WORTH_STALENESS_MS + 1) })],
      { now: NOW },
    );
    expect(past.stale).toBe(true);
  });

  it("is stale when there is nothing to show", () => {
    const result = netWorth([account("ing", null), account("etoro", null)], { now: NOW });
    expect(result.balance).toBeNull();
    expect(result.stale).toBe(true);
    expect(result.capturedAt).toBeNull();
    expect(result.missing).toEqual(["ing", "etoro"]);
    expect(result.contributing).toEqual([]);
  });

  it("reports which accounts are missing rather than hiding the hole", () => {
    const result = netWorth(
      [account("ing", "1.00"), account("etoro", null), account("isybank", null)],
      { now: NOW },
    );
    expect(result.balance).toBe("1.00");
    expect(result.missing).toEqual(["etoro", "isybank"]);
  });

  it("honours an explicit budget override", () => {
    const result = netWorth([account("ing", "1.00", { capturedAt: ago(2000) })], {
      now: NOW,
      maxAgeMs: 1000,
    });
    expect(result.stale).toBe(true);
  });
});
