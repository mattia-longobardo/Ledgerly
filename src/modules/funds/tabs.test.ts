import { describe, expect, it } from "vitest";
import { fundSummary } from "./detail";
import { type HomeFund, lineOf, type FundLine, homeSummary } from "./home";
import { allPeriod, type FundFlow, type FundPeriod, yearPeriod } from "./period";
import {
  bestAndWorst,
  closesPeriodBefore,
  competenceOn,
  deductibleYears,
  inPeriod,
  legacyFundQuery,
  quarterInPeriod,
  readsPeriod,
  returnsTarget,
  valuationLines,
} from "./tabs";

const TODAY = "2028-06-15";
const flow = (on: string, chargedCents: bigint, employerCents = 0n, tfrCents = 0n): FundFlow => ({
  on,
  chargedCents: chargedCents + employerCents + tfrCents,
  feeCents: 100n,
  origin: { youCents: chargedCents, employerCents, tfrCents, otherCents: 0n },
  recurring: true,
  deductible: true,
});
const fund = (overrides: Partial<HomeFund> = {}): HomeFund => ({
  id: "f",
  name: "Fondo",
  type: "pac",
  archived: false,
  points: [
    { on: "2027-03-01", cents: 101_000n },
    { on: "2027-03-31", cents: 100_000n },
    { on: "2028-01-01", cents: 205_000n },
    { on: "2028-05-31", cents: 215_000n },
  ],
  flows: [flow("2027-01-10", 100_000n), flow("2027-07-10", 100_000n), flow("2028-06-01", 5_000n)],
  accrued: [],
  ...overrides,
});
const line = (one: HomeFund, period: FundPeriod): FundLine => lineOf(one, period);
const total = (one: HomeFund, period: FundPeriod) =>
  valuationLines(line(one, period), period).reduce((sum, row) => sum + (row.gainCents ?? 0n), 0n);

describe("the Valuations tab", () => {
  const periods: [string, FundPeriod][] = [
    ["2027", yearPeriod(2027, TODAY)],
    ["2028", yearPeriod(2028, TODAY)],
    ["All", allPeriod(TODAY)],
    ["custom", { from: "2027-03-01", to: "2027-12-31" }],
  ];

  it.each(periods)("adds up to the gain of the Overview, to the cent, %s", (_name, period) => {
    const { line: overview } = fundSummary({ fund: fund(), period, todayOn: TODAY });
    expect(total(fund(), period)).toBe(overview.measure.gainCents);
  });

  it("adds up with a withdrawal, a transfer and a reading from units", () => {
    const busy = fund({
      flows: [
        flow("2027-01-10", 100_000n),
        { ...flow("2027-05-10", 0n), chargedCents: -30_000n, origin: flow("2027-05-10", 0n).origin },
        flow("2027-07-10", 100_000n, 50_000n, 20_000n),
      ],
    });
    for (const period of [yearPeriod(2027, TODAY), yearPeriod(2028, TODAY), allPeriod(TODAY)]) {
      expect(total(busy, period)).toBe(line(busy, period).measure.gainCents);
    }
  });

  it("gives one line per value, newest first, with the stretch that ends on it", () => {
    const lines = valuationLines(line(fund(), yearPeriod(2027, TODAY)), yearPeriod(2027, TODAY));
    expect(lines.map((row) => row.on)).toEqual(["2028-01-01", "2027-03-31", "2027-03-01"]);
    const [closing, march, first] = lines;
    // The reading of 1 January closes the year before (decision 3 of §9).
    expect(closing).toMatchObject({ fromOn: "2027-03-31", paidCents: 100_000n, gainCents: 5_000n });
    expect(march).toMatchObject({ kind: "stretch", fromOn: "2027-03-01", paidCents: 0n, gainCents: -1_000n });
    expect(march.rate).toBeCloseTo(-1_000 / 101_000, 6);
    // From no value: it has its gain, so the sum holds, but a return needs two values.
    expect(first).toMatchObject({ kind: "first", fromOn: null, paidCents: 100_000n, gainCents: 1_000n });
    expect(first.rate).toBeNull();
  });

  it("does not count the 1 January reading again in the year it opens", () => {
    const lines = valuationLines(line(fund(), yearPeriod(2028, TODAY)), yearPeriod(2028, TODAY));
    expect(lines.map((row) => row.on)).toEqual(["2028-05-31"]);
    expect(lines[0].fromOn).toBe("2028-01-01");
  });

  it("shows a first value with no money before it as a position, with no gain", () => {
    const opening = fund({
      points: [
        { on: "2027-02-01", cents: 50_000n },
        { on: "2027-03-31", cents: 51_000n },
      ],
      flows: [],
    });
    const lines = valuationLines(line(opening, allPeriod(TODAY)), allPeriod(TODAY));
    expect(lines.map((row) => row.kind)).toEqual(["stretch", "position"]);
    expect(lines[1]).toMatchObject({ gainCents: null, paidCents: null, rate: null });
    expect(total(opening, allPeriod(TODAY))).toBe(1_000n);
  });

  it("says nothing where the period has no value", () => {
    const period = yearPeriod(2026, TODAY);
    expect(valuationLines(line(fund(), period), period)).toEqual([]);
  });

  it("finds the best and the worst stretch, and only among the ones with a return", () => {
    const period = allPeriod(TODAY);
    const { best, worst } = bestAndWorst(valuationLines(line(fund(), period), period));
    expect(worst?.on).toBe("2027-03-31");
    expect(best?.on).toBe("2028-05-31");
  });
});

describe("the Contributions tab", () => {
  it("filters by period, both ends included", () => {
    const period = yearPeriod(2027, TODAY);
    expect(inPeriod("2027-01-01", period)).toBe(true);
    expect(inPeriod("2027-12-31", period)).toBe(true);
    expect(inPeriod("2028-01-01", period)).toBe(false);
    expect(inPeriod("1999-01-01", allPeriod(TODAY))).toBe(true);
  });

  it("counts a payslip on the day the home counts it", () => {
    expect(competenceOn({ payrollPeriod: "2027-02-01", year: 2027, quarter: 1 })).toBe("2027-02-01");
    expect(competenceOn({ payrollPeriod: null, year: 2027, quarter: 4 })).toBe("2027-10-01");
  });

  it("keeps a quarter where its months, its deadline or its credit fall", () => {
    const fourth = { year: 2026, quarter: 4, due: "2027-01-20", operationDates: [] };
    expect(quarterInPeriod(fourth, yearPeriod(2026, TODAY))).toBe(true);
    expect(quarterInPeriod(fourth, yearPeriod(2027, TODAY))).toBe(true);
    expect(quarterInPeriod(fourth, yearPeriod(2028, TODAY))).toBe(false);
    expect(
      quarterInPeriod({ ...fourth, due: null, operationDates: ["2028-02-02"] }, yearPeriod(2028, TODAY)),
    ).toBe(true);
    expect(quarterInPeriod(fourth, { from: "2026-12-01", to: "2026-12-31" })).toBe(true);
    expect(quarterInPeriod(fourth, { from: "2026-07-01", to: "2026-09-30" })).toBe(false);
  });

  const paying = fund({
    type: "pension",
    flows: [
      flow("2026-07-10", 10_000n, 15_000n, 35_000n),
      flow("2027-01-10", 10_000n, 15_000n, 35_000n),
      flow("2027-07-10", 10_000n, 15_000n, 35_000n),
    ],
  });

  it("counts you + employer and never the TFR", () => {
    const [year] = deductibleYears(paying.flows, yearPeriod(2027, TODAY), TODAY);
    expect(year).toMatchObject({ year: 2027, youCents: 20_000n, employerCents: 30_000n, usedCents: 50_000n });
    expect(year.limitCents).toBe(530_000n);
  });

  it("is the same figure as the KPI of that year", () => {
    const period = { ...yearPeriod(2027, TODAY), year: 2027 };
    const { deductible } = homeSummary({ funds: [paying], period, todayOn: TODAY, firstOn: "2026-07-10" });
    expect(deductibleYears(paying.flows, period, TODAY)[0].usedCents).toBe(deductible!.usedCents);
  });

  it("leaves out money dated after today, as the KPI of that year does", () => {
    const dated = fund({
      type: "pension",
      flows: [flow("2028-02-10", 10_000n, 5_000n), flow("2028-09-01", 7_000n)],
    });
    const period = { ...yearPeriod(2028, TODAY), year: 2028 };
    const { deductible } = homeSummary({ funds: [dated], period, todayOn: TODAY, firstOn: "2028-02-10" });
    expect(deductible!.usedCents).toBe(15_000n);
    expect(deductibleYears(dated.flows, period, TODAY)[0].usedCents).toBe(15_000n);
    expect(deductibleYears(dated.flows, allPeriod(TODAY), TODAY)[0].usedCents).toBe(15_000n);
  });

  it("shows the years the period touches, newest first", () => {
    expect(deductibleYears(paying.flows, allPeriod(TODAY), TODAY).map((row) => row.year)).toEqual([
      2027, 2026,
    ]);
    expect(deductibleYears(paying.flows, yearPeriod(2026, TODAY), TODAY).map((row) => row.year)).toEqual([
      2026,
    ]);
    expect(
      deductibleYears(paying.flows, { from: "2026-12-01", to: "2027-01-31" }, TODAY).map((row) => row.year),
    ).toEqual([2027, 2026]);
    expect(deductibleYears(paying.flows, yearPeriod(2028, TODAY), TODAY)).toEqual([]);
  });
});

describe("the old addresses", () => {
  it("leaves a new address alone", () => {
    expect(legacyFundQuery({}, TODAY)).toBeNull();
    expect(legacyFundQuery({ period: "2027", tab: "valuations" }, TODAY)).toBeNull();
    expect(legacyFundQuery({ from: "2027-01-01", to: "2027-03-31" }, TODAY)).toBeNull();
  });

  it("sends `span` to the new parameter, and keeps the rest", () => {
    expect(legacyFundQuery({ span: "12", tab: "valuations" }, TODAY)).toEqual({ tab: "valuations" });
    expect(legacyFundQuery({ span: "60" }, TODAY)).toEqual({ period: "all" });
    expect(legacyFundQuery({ span: "6" }, TODAY)).toEqual({ from: "2028-01-01", to: TODAY });
    expect(legacyFundQuery({ span: "24" }, TODAY)).toEqual({ from: "2026-07-01", to: TODAY });
    expect(legacyFundQuery({ span: "nonsense", tab: "settings" }, TODAY)).toEqual({ tab: "settings" });
  });

  it("sends `from` and `to` by month to days, and they win over `span`", () => {
    expect(legacyFundQuery({ from: "2027-01", to: "2027-03" }, TODAY)).toEqual({
      from: "2027-01-01",
      to: "2027-03-31",
    });
    expect(legacyFundQuery({ from: "2027-01", to: "2027-03", span: "24", tab: "valuations" }, TODAY)).toEqual(
      {
        tab: "valuations",
        from: "2027-01-01",
        to: "2027-03-31",
      },
    );
    expect(legacyFundQuery({ period: "2027", span: "60" }, TODAY)).toEqual({ period: "2027" });
  });

  it("sends the returns page to the Valuations tab, with the period", () => {
    const base = "/funds/abc";
    expect(returnsTarget(base, {}, TODAY)).toBe("/funds/abc?tab=valuations");
    expect(returnsTarget(base, { period: "2027" }, TODAY)).toBe("/funds/abc?tab=valuations&period=2027");
    expect(returnsTarget(base, { span: "60" }, TODAY)).toBe("/funds/abc?tab=valuations&period=all");
    expect(returnsTarget(base, { from: "2027-01", to: "2027-03", view: "value" }, TODAY)).toBe(
      "/funds/abc?tab=valuations&from=2027-01-01&to=2027-03-31",
    );
  });
});

describe("the enrolment fee and the deductible (funds-ux §5.3)", () => {
  const enrolment: FundFlow = {
    on: "2027-02-10",
    chargedCents: 1_032n,
    feeCents: 1_032n,
    origin: { youCents: 516n, employerCents: 516n, tfrCents: 0n, otherCents: 0n },
    recurring: false,
    deductible: false,
  };
  const paying = fund({ type: "pension", flows: [flow("2027-01-10", 10_000n, 5_000n), enrolment] });
  const period = { ...yearPeriod(2027, TODAY), year: 2027 };

  it("leaves it out of the tab and of the KPI, which do not differ", () => {
    const [year] = deductibleYears(paying.flows, period, TODAY);
    expect(year).toMatchObject({ youCents: 10_000n, employerCents: 5_000n, usedCents: 15_000n });
    const { deductible } = homeSummary({ funds: [paying], period, todayOn: TODAY, firstOn: "2027-01-10" });
    expect(deductible!.usedCents).toBe(15_000n);
  });

  it("keeps it in the money paid in", () => {
    const { paidInCents } = homeSummary({ funds: [paying], period, todayOn: TODAY, firstOn: "2027-01-10" });
    expect(paidInCents).toBe(16_032n);
  });

  it("has no deductible year for an enrolment fee alone", () => {
    expect(deductibleYears([enrolment], period, TODAY)).toEqual([]);
  });
});

describe("a reading of the 1st (decision 3 of funds-ux §9)", () => {
  it("belongs to the year it closes, as a value of that day does", () => {
    expect(readsPeriod("2027-01-01", yearPeriod(2026, TODAY))).toBe(true);
    expect(readsPeriod("2027-01-01", yearPeriod(2027, TODAY))).toBe(false);
    expect(readsPeriod("2027-01-02", yearPeriod(2027, TODAY))).toBe(true);
    expect(readsPeriod("2027-01-01", allPeriod(TODAY))).toBe(true);
  });

  it("is said to close the period before, and only then", () => {
    expect(closesPeriodBefore("2027-01-01", yearPeriod(2027, TODAY))).toBe(true);
    expect(closesPeriodBefore("2027-01-02", yearPeriod(2027, TODAY))).toBe(false);
    expect(closesPeriodBefore("2026-12-31", yearPeriod(2027, TODAY))).toBe(false);
    expect(closesPeriodBefore("2027-01-01", allPeriod(TODAY))).toBe(false);
  });
});

describe("a span that is not a span", () => {
  it.each(["99999999999", "1201", "abc", "-3", "0", "1e3"])("%s is dropped from the address", (span) => {
    expect(legacyFundQuery({ span, tab: "valuations" }, TODAY)).toEqual({ tab: "valuations" });
  });

  it("keeps a real number of months", () => {
    expect(legacyFundQuery({ span: "24" }, TODAY)).toEqual({ from: "2026-07-01", to: TODAY });
  });
});
