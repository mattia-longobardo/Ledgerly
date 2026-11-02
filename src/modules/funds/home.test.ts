import { describe, expect, it } from "vitest";
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import {
  type AccruedLine,
  describedDay,
  firstDataOn,
  gainBars,
  gainGrain,
  type HomeFund,
  homeSummary,
  isFutureYear,
  staleFunds,
  stretchesOf,
  valueSeries,
  valueToday,
  yearRows,
} from "./home";
import { allPeriod, type FundFlow, yearPeriod } from "./period";

const TODAY = "2028-06-15";

const flow = (on: CivilDate, chargedCents: Cents, feeCents: Cents | null = 0n): FundFlow => ({
  on,
  chargedCents,
  feeCents,
  origin: { youCents: chargedCents, employerCents: 0n, tfrCents: 0n, otherCents: 0n },
  recurring: true,
  deductible: true,
});

const fund = (overrides: Partial<HomeFund> & { id: string }): HomeFund => ({
  name: overrides.id,
  type: "pac",
  archived: false,
  points: [],
  flows: [],
  accrued: [],
  ...overrides,
});

const accrued = (on: CivilDate, cents: Cents, dueOn: CivilDate | null = null): AccruedLine => ({
  on,
  cents,
  dueOn,
});

const year = (value: number) => ({ ...yearPeriod(value, TODAY), year: value });

const summaryOf = (funds: HomeFund[], period: Parameters<typeof homeSummary>[0]["period"]) =>
  homeSummary({ funds, period, todayOn: TODAY, firstOn: firstDataOn(funds) });

const PAC = fund({
  id: "pac",
  points: [
    { on: "2026-02-01", cents: 110_00n },
    { on: "2026-03-20", cents: 240_00n },
    { on: "2027-01-01", cents: 260_00n },
    { on: "2028-03-01", cents: 410_00n },
  ],
  flows: [
    flow("2026-01-01", 100_00n, 1_00n),
    flow("2026-03-01", 120_00n, 1_00n),
    flow("2027-07-17", 20_00n, 50n),
    flow("2028-01-01", 110_00n),
    flow("2028-05-01", 50_00n, 1_00n),
  ],
});

const PENSION = fund({
  id: "pension",
  type: "pension",
  points: [
    { on: "2027-09-30", cents: 500_00n },
    { on: "2028-02-29", cents: 780_00n },
  ],
  flows: [
    {
      ...flow("2027-04-20", 490_00n, 3_00n),
      origin: { youCents: 100_00n, employerCents: 90_00n, tfrCents: 300_00n, otherCents: 0n },
    },
    {
      ...flow("2028-01-20", 260_00n, 2_00n),
      origin: { youCents: 60_00n, employerCents: 50_00n, tfrCents: 150_00n, otherCents: 0n },
    },
  ],
  accrued: [accrued("2026-11-30", 40_00n, "2027-01-20"), accrued("2026-12-31", 60_00n, "2027-01-20")],
});

describe("the portfolio over a period", () => {
  it("makes the rows add up to the hero, and market − fees = gain", () => {
    for (const period of [year(2026), year(2027), year(2028), allPeriod(TODAY)]) {
      const summary = summaryOf([PAC, PENSION], period);
      const rows = summary.lines
        .filter((line) => line.status === "measured")
        .reduce<Cents>((total, line) => total + line.measure.gainCents!, 0n);
      expect(rows).toBe(summary.gainCents);
      expect(summary.marketCents! - summary.feesCents).toBe(summary.gainCents);
    }
  });

  it("makes the years add up to All, to the cent, line by line", () => {
    const funds = [PAC, PENSION];
    const rows = yearRows(funds, TODAY, firstDataOn(funds));
    const all = summaryOf(funds, allPeriod(TODAY));
    const gain = rows.reduce<Cents>((total, row) => total + (row.summary.gainCents ?? 0n), 0n);
    expect(gain).toBe(all.gainCents);
    expect(rows.map((row) => row.year)).toEqual([2028, 2027, 2026]);
  });

  it("drives the paid-in, its origin and the deductible from the calendar of the period", () => {
    const summary = summaryOf([PAC, PENSION], year(2027));
    expect(summary.paidInCents).toBe(510_00n);
    expect(summary.origin).toEqual({
      youCents: 120_00n,
      employerCents: 90_00n,
      tfrCents: 300_00n,
      otherCents: 0n,
    });
    // A PAC's money is yours, but only the pension fund is deductible.
    expect(summary.deductible).toEqual({ usedCents: 190_00n, limitCents: 530_000n });
  });

  it("has no deductible without a year or without a pension fund", () => {
    expect(summaryOf([PAC, PENSION], allPeriod(TODAY)).deductible).toBeNull();
    expect(summaryOf([PAC], year(2027)).deductible).toBeNull();
  });

  it("states the money after the last value, only for a fund that has one", () => {
    expect(summaryOf([PAC], year(2028)).notInValueCents).toBe(50_00n);
    const never = fund({ id: "never", flows: [flow("2028-02-01", 90_00n)] });
    expect(summaryOf([never], year(2028)).notInValueCents).toBe(0n);
  });

  it("states the span of the dates of the values", () => {
    const summary = summaryOf([PAC, PENSION], year(2028));
    expect([summary.valueFrom, summary.valueTo]).toEqual(["2028-02-29", "2028-03-01"]);
    expect(summary.valueCents).toBe(1_190_00n);
  });

  it("gives a percentage of the portfolio only while the values are close", () => {
    expect(summaryOf([PAC, PENSION], year(2028)).rate).not.toBeNull();
    const late = fund({
      id: "late",
      points: [
        { on: "2028-01-05", cents: 100_00n },
        { on: "2028-06-10", cents: 110_00n },
      ],
    });
    const summary = summaryOf([PAC, late], year(2028));
    expect(summary.gainCents).not.toBeNull();
    expect(summary.rate).toBeNull();
  });

  it("gives one fund's own percentage when it is alone", () => {
    const summary = summaryOf([PAC], year(2028));
    expect(summary.rate).toBe(summary.lines[0].measure.rate);
  });

  it("gives the XIRR only over a year or more", () => {
    expect(summaryOf([PENSION], year(2028)).xirr).toBeNull();
    expect(summaryOf([PAC], allPeriod(TODAY)).xirr).not.toBeNull();
    expect(summaryOf([PAC, PENSION], allPeriod(TODAY)).xirr).not.toBeNull();
  });
});

describe("the states of §6", () => {
  it("a year with payslips alone: not determinable, never zero", () => {
    const summary = summaryOf([PENSION], year(2026));
    expect(summary.state).toBe("payslips_only");
    expect(summary.gainCents).toBeNull();
    expect(summary.marketCents).toBeNull();
    expect(summary.accruedCents).toBe(100_00n);
    expect(summary.paidInCents).toBe(0n);
  });

  it("a year with money in and no value: not determinable, paid-in and fees stand", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2025-03-31", cents: 50_00n },
          { on: "2027-02-28", cents: 330_00n },
        ],
        flows: [flow("2025-01-10", 49_00n), flow("2026-05-10", 200_00n, 2_00n)],
      }),
    ];
    const summary = summaryOf(funds, year(2026));
    expect(summary.state).toBe("paid_no_value");
    expect(summary.gainCents).toBeNull();
    expect(summary.paidInCents).toBe(200_00n);
    expect(summary.feesCents).toBe(2_00n);
  });

  it("a year with nothing and an older value: no value, and the last known one", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2025-03-31", cents: 50_00n },
          { on: "2027-02-28", cents: 60_00n },
        ],
        flows: [flow("2025-01-10", 49_00n)],
      }),
    ];
    const summary = summaryOf(funds, year(2026));
    expect(summary.state).toBe("quiet");
    expect(summary.gainCents).toBeNull();
    expect(summary.valueCents).toBe(50_00n);
    expect(summary.valueTo).toBe("2025-03-31");
  });

  it("a value in a year with no money: a gain of 0 is real", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2025-03-31", cents: 50_00n },
          { on: "2026-03-31", cents: 50_00n },
        ],
        flows: [flow("2025-01-10", 49_00n)],
      }),
    ];
    const summary = summaryOf(funds, year(2026));
    expect(summary.state).toBe("measured");
    expect(summary.gainCents).toBe(0n);
  });

  it("the year running with no value yet", () => {
    const funds = [
      fund({
        id: "a",
        points: [{ on: "2027-11-30", cents: 50_00n }],
        flows: [flow("2027-01-10", 49_00n), flow("2028-01-10", 10_00n)],
      }),
    ];
    const summary = summaryOf(funds, year(2028));
    expect(summary.state).toBe("running_no_value");
    expect(summary.gainCents).toBeNull();
    expect(summary.paidInCents).toBe(10_00n);
    expect(summary.valueCents).toBe(50_00n);
    expect(summary.notInValueCents).toBe(10_00n);
  });

  it("one fund without a value among others: stays in the list, out of the sum", () => {
    const empty = fund({ id: "empty", flows: [flow("2028-02-01", 90_00n)] });
    const summary = summaryOf([PAC, empty], year(2028));
    expect(summary.state).toBe("partial");
    const line = summary.lines.find((one) => one.fund.id === "empty")!;
    expect(line.status).toBe("never_valued");
    expect(summary.gainCents).toBe(summaryOf([PAC], year(2028)).gainCents);
    expect(summary.paidInCents).toBe(summaryOf([PAC], year(2028)).paidInCents + 90_00n);
  });

  it("a year before the first data", () => {
    expect(summaryOf([PAC, PENSION], year(2023)).state).toBe("before_first");
  });

  it("an open fund with nothing yet keeps its row where its first value is recorded", () => {
    const empty = fund({ id: "empty" });
    const running = summaryOf([PAC, empty], year(2028));
    expect(running.lines.map((line) => line.fund.id)).toContain("empty");
    expect(running.lines.find((line) => line.fund.id === "empty")!.status).toBe("never_valued");
    expect(summaryOf([PAC, empty], year(2026)).lines.map((line) => line.fund.id)).toEqual(["pac"]);
  });

  it("an archived fund counts only where it has data, so the years still add up (decision 5)", () => {
    const closed = fund({
      id: "closed",
      archived: true,
      points: [
        { on: "2026-02-28", cents: 100_00n },
        { on: "2026-11-30", cents: 130_00n },
      ],
      flows: [flow("2026-01-10", 90_00n), flow("2026-06-10", 20_00n)],
    });
    const funds = [PAC, closed];
    expect(summaryOf(funds, year(2026)).lines.map((line) => line.fund.id)).toContain("closed");
    expect(summaryOf(funds, year(2028)).lines.map((line) => line.fund.id)).not.toContain("closed");
    const gain = yearRows(funds, TODAY, firstDataOn(funds)).reduce<Cents>(
      (total, row) => total + (row.summary.gainCents ?? 0n),
      0n,
    );
    expect(gain).toBe(summaryOf(funds, allPeriod(TODAY)).gainCents);
  });
});

describe("the value of an archived fund", () => {
  const closed = fund({
    id: "closed",
    archived: true,
    points: [{ on: "2026-02-28", cents: 100_00n }],
    flows: [flow("2026-01-10", 90_00n)],
  });

  it("is not money held today: out of a period that reaches today, its gain still in", () => {
    const with_ = summaryOf([PAC, closed], allPeriod(TODAY));
    const without = summaryOf([PAC], allPeriod(TODAY));
    expect(with_.valueCents).toBe(without.valueCents);
    expect(with_.gainCents).toBe(without.gainCents! + 10_00n);
  });

  it("stays in the value of a past period where it has data", () => {
    expect(summaryOf([PAC, closed], year(2026)).valueCents).toBe(260_00n + 100_00n);
  });
});

describe("the first year the stepper reaches", () => {
  it("is the year before when the deposit and the first value both fall on the 1st of January", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2026-01-01", cents: 101_00n },
          { on: "2026-03-31", cents: 110_00n },
        ],
        flows: [flow("2026-01-01", 100_00n)],
      }),
    ];
    const first = firstDataOn(funds);
    expect(first).toBe("2025-12-31");
    const before = homeSummary({ funds, period: year(2025), todayOn: TODAY, firstOn: first });
    expect(before.state).toBe("measured");
    expect(before.gainCents).toBe(1_00n);
    // The money still went in on its own day.
    expect(before.paidInCents).toBe(0n);
    expect(homeSummary({ funds, period: year(2026), todayOn: TODAY, firstOn: first }).gainCents).toBe(9_00n);
  });

  it("walks to the month before for a first value on the 1st of any month, and draws its bar", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2028-03-01", cents: 101_00n },
          { on: "2028-05-15", cents: 110_00n },
        ],
        flows: [flow("2028-03-01", 100_00n)],
      }),
    ];
    const first = firstDataOn(funds);
    expect(first).toBe("2028-02-29");
    const summary = homeSummary({ funds, period: year(2028), todayOn: TODAY, firstOn: first });
    const bars = gainBars(summary.lines, { from: first!, to: TODAY }, "month");
    expect(bars[0]).toMatchObject({ from: "2028-02-01", totalCents: 1_00n });
    expect(bars.reduce<Cents>((total, bar) => total + (bar.totalCents ?? 0n), 0n)).toBe(10_00n);
  });

  it("keeps a stretch on the edge of the span in the nearest bar, so the sum holds", () => {
    const funds = [
      fund({
        id: "a",
        points: [
          { on: "2028-03-01", cents: 101_00n },
          { on: "2028-05-15", cents: 110_00n },
        ],
        flows: [flow("2028-03-01", 100_00n)],
      }),
    ];
    const summary = summaryOf(funds, year(2028));
    const bars = gainBars(summary.lines, { from: "2028-03-01", to: TODAY }, "month");
    expect(bars.reduce<Cents>((total, bar) => total + (bar.totalCents ?? 0n), 0n)).toBe(10_00n);
  });

  it("stays on the year when a first value on the 1st of January has no money before it", () => {
    const funds = [fund({ id: "a", points: [{ on: "2026-01-01", cents: 100_00n }] })];
    expect(firstDataOn(funds)).toBe("2026-01-01");
  });

  it("reaches the payslips, even with no money yet", () => {
    expect(firstDataOn([fund({ id: "a", accrued: [accrued("2025-10-31", 1n)] })])).toBe("2025-10-31");
  });

  it("is null with no data", () => {
    expect(firstDataOn([fund({ id: "a" })])).toBeNull();
  });
});

describe("the chart", () => {
  const lineOf = (one: HomeFund, value: number) => summaryOf([one], year(value)).lines[0];

  it("puts a value of the 1st in the month before", () => {
    expect(describedDay("2028-03-01")).toBe("2028-02-29");
    expect(describedDay("2028-03-02")).toBe("2028-03-02");
    const line = lineOf(PAC, 2028);
    const bars = gainBars([line], { from: "2028-01-01", to: TODAY }, "month");
    expect(bars.map((bar) => bar.from)).toEqual([
      "2028-01-01",
      "2028-02-01",
      "2028-03-01",
      "2028-04-01",
      "2028-05-01",
      "2028-06-01",
    ]);
    expect(bars[1].totalCents).toBe(line.measure.gainCents);
  });

  it("makes the bars add up to the gain, and leaves the months with no reading empty, not zero", () => {
    for (const value of [2026, 2027, 2028]) {
      const line = lineOf(PAC, value);
      const bars = gainBars([line], { from: `${value}-01-01`, to: `${value}-12-31` }, "month");
      const total = bars.reduce<Cents>((sum, bar) => sum + (bar.totalCents ?? 0n), 0n);
      expect(total).toBe(line.measure.gainCents ?? 0n);
      expect(bars.filter((bar) => bar.totalCents !== null).length).toBeLessThan(bars.length);
      expect(bars.some((bar) => bar.totalCents === 0n && bar.stretches.length === 0)).toBe(false);
    }
  });

  it("keeps a stretch longer than a month as one bar, with its dates", () => {
    const line = lineOf(PAC, 2028);
    const bars = gainBars([line], { from: "2028-01-01", to: TODAY }, "month");
    expect(bars[1].stretches).toEqual([
      { fundId: "pac", from: "2027-01-01", to: "2028-03-01", gainCents: 20_00n },
    ]);
  });

  it("makes the bars of All, by year, the same as the gains of the years", () => {
    const funds = [PAC, PENSION];
    const all = summaryOf(funds, allPeriod(TODAY));
    const bars = gainBars(all.lines, { from: firstDataOn(funds)!, to: TODAY }, "year");
    for (const bar of bars) {
      const expected = summaryOf(funds, year(Number(bar.from.slice(0, 4)))).gainCents;
      expect(bar.totalCents ?? null).toBe(expected);
    }
  });

  it("goes by month in a year, however little of it has passed", () => {
    const running = { ...yearPeriod(2028, "2028-02-10"), year: 2028 };
    expect(gainGrain(running, { from: "2028-01-01", to: "2028-02-10" })).toBe("month");
  });

  it("picks the grain from the period", () => {
    expect(gainGrain(allPeriod(TODAY), { from: "2026-01-01", to: TODAY })).toBe("year");
    expect(gainGrain(yearPeriod(2027, TODAY), { from: "2027-01-01", to: "2027-12-31" })).toBe("month");
    expect(
      gainGrain({ from: "2027-01-01", to: "2027-03-31" }, { from: "2027-01-01", to: "2027-03-31" }),
    ).toBe("stretch");
    expect(
      gainGrain({ from: "2025-01-01", to: "2027-03-31" }, { from: "2025-01-01", to: "2027-03-31" }),
    ).toBe("year");
  });

  it("draws the stretches of a short custom period", () => {
    const period = { from: "2026-01-15", to: "2026-03-31" };
    const { lines } = summaryOf([PAC], period);
    const bars = gainBars(lines, period, "stretch");
    expect(bars.map((bar) => bar.to)).toEqual(["2026-02-01", "2026-03-20"]);
  });

  it("has no stretch for a fund it cannot measure", () => {
    const empty = fund({ id: "empty", flows: [flow("2028-02-01", 90_00n)] });
    expect(stretchesOf(lineOf(empty, 2028))).toEqual([]);
  });

  it("the Value view has a point per reading and no other, and never a loss a deposit made", () => {
    // A deposit between two readings: 100 → (+50 on 10 Feb) → 155 on 28 Feb. No loss anywhere.
    const one = fund({
      id: "a",
      points: [
        { on: "2028-01-31", cents: 100_00n },
        { on: "2028-02-28", cents: 155_00n },
      ],
      flows: [flow("2028-01-01", 100_00n), flow("2028-02-10", 50_00n)],
    });
    const series = valueSeries(summaryOf([one], year(2028)).lines);
    expect(series).toEqual([
      { on: "2028-01-31", valueCents: 100_00n, paidCents: 100_00n },
      { on: "2028-02-28", valueCents: 155_00n, paidCents: 150_00n },
    ]);
  });

  it("a deposit after the last reading waits for the next one", () => {
    const one = fund({
      id: "a",
      points: [{ on: "2028-01-31", cents: 100_00n }],
      flows: [flow("2028-01-01", 100_00n), flow("2028-05-01", 50_00n)],
    });
    const series = valueSeries(summaryOf([one], year(2028)).lines);
    expect(series).toEqual([{ on: "2028-01-31", valueCents: 100_00n, paidCents: 100_00n }]);
  });

  it("each fund counts with the money its own last reading could see", () => {
    const series = valueSeries(summaryOf([PAC, PENSION], year(2028)).lines);
    const gainOf = (row: (typeof series)[number]) => row.valueCents - row.paidCents;
    // Every gap between the two lines is a documented gain: with both funds read, the sum of "All".
    const all = summaryOf([PAC, PENSION], allPeriod(TODAY));
    expect(gainOf(series.at(-1)!)).toBe(all.gainCents);
  });

  it("a first value with no money before it is a position, not a gain", () => {
    const one = fund({
      id: "a",
      points: [
        { on: "2028-01-31", cents: 500_00n },
        { on: "2028-03-31", cents: 510_00n },
      ],
    });
    const series = valueSeries(summaryOf([one], year(2028)).lines);
    expect(series[0]).toEqual({ on: "2028-01-31", valueCents: 500_00n, paidCents: 500_00n });
  });
});

describe("the address", () => {
  it("sends only a year still to come back to the year running", () => {
    expect(isFutureYear("2029", TODAY)).toBe(true);
    expect(isFutureYear("2028", TODAY)).toBe(false);
    expect(isFutureYear("2023", TODAY)).toBe(false);
    expect(isFutureYear("all", TODAY)).toBe(false);
    expect(isFutureYear(undefined, TODAY)).toBe(false);
  });
});

describe("what stays as of today", () => {
  it("lists the funds with a value older than 31 days, oldest first", () => {
    const fresh = fund({ id: "fresh", points: [{ on: "2028-06-01", cents: 1n }] });
    const limit = fund({ id: "limit", points: [{ on: "2028-05-15", cents: 1n }] });
    const old = fund({ id: "old", points: [{ on: "2028-05-14", cents: 1n }] });
    const older = fund({ id: "older", points: [{ on: "2027-05-14", cents: 1n }] });
    const never = fund({ id: "never" });
    const closed = fund({ id: "closed", archived: true, points: [{ on: "2020-01-31", cents: 1n }] });
    const stale = staleFunds([fresh, limit, old, older, never, closed], TODAY);
    expect(stale.map((one) => one.fund.id)).toEqual(["older", "old"]);
  });

  it("values only the open funds, each with its own last reading", () => {
    const closed = fund({ id: "closed", archived: true, points: [{ on: "2026-01-31", cents: 7n }] });
    expect(valueToday([PAC, PENSION, closed], TODAY)).toBe(410_00n + 780_00n);
    expect(valueToday([closed], TODAY)).toBeNull();
  });
});
