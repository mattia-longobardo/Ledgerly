import { describe, expect, it } from "vitest";
import { flowCounts, fundSummary, hypothesesOnly, isFundId, recentFlows, withoutSpan } from "./detail";
import { gainBars, type HomeFund, homeSummary, valueSeries } from "./home";
import { allPeriod, type FundFlow, yearPeriod } from "./period";
import type { FundForecast } from "./rules";

const TODAY = "2028-06-15";
const flow = (on: string, chargedCents: bigint, recurring = true): FundFlow => ({
  on,
  chargedCents,
  feeCents: 100n,
  origin: { youCents: chargedCents, employerCents: 0n, tfrCents: 0n, otherCents: 0n },
  recurring,
});
const fund = (overrides: Partial<HomeFund> = {}): HomeFund => ({
  id: "f",
  name: "Fondo",
  type: "pac",
  archived: false,
  points: [
    { on: "2027-06-30", cents: 101_000n },
    { on: "2028-01-01", cents: 205_000n },
    { on: "2028-05-31", cents: 215_000n },
  ],
  flows: [flow("2027-01-10", 100_000n), flow("2027-07-10", 100_000n), flow("2028-06-01", 5_000n, false)],
  accrued: [],
  ...overrides,
});

describe("fundSummary", () => {
  const other = fund({ id: "g", name: "Altro" });

  it.each([yearPeriod(2027, TODAY), yearPeriod(2028, TODAY), allPeriod(TODAY)])(
    "gives the fund the gain and the return of its row in the home, %#",
    (period) => {
      const home = homeSummary({ funds: [fund(), other], period, todayOn: TODAY, firstOn: "2027-01-10" });
      const { line } = fundSummary({ fund: fund(), period, todayOn: TODAY });
      const row = home.lines.find((one) => one.fund.id === "f")!;
      expect(line.measure.gainCents).toBe(row.measure.gainCents);
      expect(line.measure.rate).toBe(row.measure.rate);
      expect(line.measure.xirr).toEqual(row.measure.xirr);
    },
  );

  it("still has the fund's line where the home leaves it out", () => {
    const archived = fund({ archived: true, points: [], flows: [] });
    const { summary, line } = fundSummary({
      fund: archived,
      period: yearPeriod(2028, TODAY),
      todayOn: TODAY,
    });
    expect(summary.lines).toHaveLength(0);
    expect(line.fund.id).toBe("f");
    expect(line.measure.gainCents).toBeNull();
  });

  it("says a year before the fund's first data is before it", () => {
    const { beforeFirst } = fundSummary({ fund: fund(), period: yearPeriod(2020, TODAY), todayOn: TODAY });
    expect(beforeFirst).toBe(true);
  });

  it("keeps the gain of a first value on the 1st of January, which the year before can see", () => {
    const position = fund({ points: [{ on: "2028-01-01", cents: 100_000n }], flows: [] });
    const { beforeFirst, line } = fundSummary({
      fund: position,
      period: yearPeriod(2027, TODAY),
      todayOn: TODAY,
    });
    expect(line.status).toBe("measured");
    expect(line.measure.gainCents).toBe(0n);
    expect(beforeFirst).toBe(false);
  });
});

describe("a reading behind the money", () => {
  // The contribution of 15 Jul has reached no reading until the next one: on a monthly grid the value
  // stood still under the money, and drew a loss that nobody had.
  const pension = fund({
    points: [
      { on: "2028-03-31", cents: 100_000n },
      { on: "2028-07-01", cents: 151_000n },
    ],
    flows: [flow("2028-01-15", 99_000n), flow("2028-04-15", 50_000n)],
  });
  const today = "2028-12-01";

  it("has no stretch that is a loss, in the bars or in the series", () => {
    const period = yearPeriod(2028, today);
    const { line } = fundSummary({ fund: pension, period, todayOn: today });
    const bars = gainBars([line], { from: period.from!, to: period.to }, "month");
    expect(bars.flatMap((bar) => bar.stretches).every((stretch) => stretch.gainCents >= 0n)).toBe(true);
    for (const point of valueSeries([line])) expect(point.valueCents >= point.paidCents).toBe(true);
  });

  it("makes a deposit after the last reading wait for the next one", () => {
    const later = fund({
      points: [{ on: "2028-03-31", cents: 100_000n }],
      flows: [flow("2028-01-15", 99_000n), flow("2028-04-15", 50_000n)],
    });
    const { line } = fundSummary({ fund: later, period: yearPeriod(2028, today), todayOn: today });
    expect(line.measure.gainCents).toBe(1_000n);
    expect(line.measure.notInValueCents).toBe(50_000n);
    expect(valueSeries([line]).at(-1)).toMatchObject({ valueCents: 100_000n, paidCents: 99_000n });
  });
});

describe("recentFlows", () => {
  it("lists the money of the period, newest first, up to the limit", () => {
    const flows = [
      flow("2027-01-10", 1n),
      flow("2028-02-10", 2n),
      flow("2028-03-10", 3n),
      flow("2028-04-10", 4n),
    ];
    expect(recentFlows(flows, yearPeriod(2028, TODAY), 2).map((one) => one.on)).toEqual([
      "2028-04-10",
      "2028-03-10",
    ]);
    expect(recentFlows(flows, allPeriod(TODAY))).toHaveLength(4);
  });

  it("leaves out a switch's cost, which moved no money", () => {
    expect(recentFlows([flow("2028-02-10", 0n)], allPeriod(TODAY))).toEqual([]);
  });
});

describe("flowCounts", () => {
  it("counts the plan's deposits and the one-offs of the period, and no exit", () => {
    const flows = [
      flow("2028-02-10", 2n),
      flow("2028-03-10", 3n, false),
      flow("2028-04-10", -4n, false),
      flow("2027-01-01", 1n),
    ];
    expect(flowCounts(flows, yearPeriod(2028, TODAY))).toEqual({ recurring: 1, oneOff: 1 });
  });
});

describe("hypothesesOnly", () => {
  const forecast: FundForecast = {
    monthlyCents: 100n,
    ownRate: 0.09,
    rates: [0.02, 0.04, 0.06, 0.09],
    rows: [{ years: 1, paidInCents: 1n, valueCents: [1n, 2n, 3n, 4n] }],
  };

  it("takes the fund's own rate away, so that one return stays on the page", () => {
    const only = hypothesesOnly(forecast);
    expect(only.ownRate).toBeNull();
    expect(only.rates).toEqual([0.02, 0.04, 0.06]);
    expect(only.rows[0].valueCents).toEqual([1n, 2n, 3n]);
  });

  it("leaves a projection with no own rate as it is", () => {
    const none = { ...forecast, ownRate: null };
    expect(hypothesesOnly(none)).toBe(none);
  });
});

describe("the address", () => {
  it("drops the old page's span and keeps the rest", () => {
    expect(withoutSpan({ span: "24", tab: "settings" })).toEqual({ tab: "settings" });
    expect(withoutSpan({ tab: "settings" })).toBeNull();
  });

  it("knows an id from anything else", () => {
    expect(isFundId("019a0000-0000-7000-8000-000000000000")).toBe(true);
    expect(isFundId("not-a-fund")).toBe(false);
  });
});
