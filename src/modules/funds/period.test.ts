import { describe, expect, it } from "vitest";
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import {
  allPeriod,
  closingDay,
  documentedEntries,
  documentedPoints,
  type FundFlow,
  latestDocumented,
  measurePeriod,
  onTheWay,
  pacFlows,
  pensionFlows,
  projectionMonthly,
  yearPeriod,
} from "./period";
import type { OperationLike, QuarterStatus } from "./pension/reconcile";

const TODAY = "2028-06-15";

const flow = (on: CivilDate, chargedCents: Cents, feeCents: Cents | null = 0n): FundFlow => ({
  on,
  chargedCents,
  feeCents,
  origin: { youCents: chargedCents, employerCents: 0n, tfrCents: 0n, otherCents: 0n },
  recurring: true,
});

const operation = (overrides: Partial<OperationLike>): OperationLike => ({
  id: `op-${overrides.operationDate}`,
  classification: "contribution",
  competenceYear: null,
  competenceQuarter: null,
  operationDate: "2026-04-13",
  workerCents: 0n,
  employerCents: 0n,
  tfrCents: 0n,
  otherCents: 0n,
  feesCents: 0n,
  netCents: 0n,
  units: "0",
  ...overrides,
});

const quarter = (overrides: Partial<QuarterStatus>, accrued: Record<string, Cents> = {}): QuarterStatus => ({
  year: 2026,
  quarter: 1,
  due: "2026-04-20",
  toleranceUntil: null,
  status: "transferred",
  reason: null,
  components: Object.entries(accrued).map(([component, accruedCents]) => ({
    component: component as QuarterStatus["components"][number]["component"],
    accruedCents,
    creditedCents: null,
    differenceCents: null,
    status: "transferred",
    decision: null,
    competenceIds: [],
    operationIds: [],
  })),
  missingMonths: [],
  operationDates: [],
  feesCents: 0n,
  netCents: 0n,
  invested: false,
  ...overrides,
});

/** Several histories, each with something the sum could trip on. */
const HISTORIES: { name: string; points: { on: CivilDate; cents: Cents }[]; flows: FundFlow[] }[] = [
  {
    name: "values on the 1st of the month, a deposit on the 1st of January",
    points: [
      { on: "2026-02-01", cents: 110_00n },
      { on: "2027-01-01", cents: 260_00n },
      { on: "2028-03-01", cents: 410_00n },
    ],
    flows: [
      flow("2026-01-01", 100_00n, 1_00n),
      flow("2026-07-17", 140_00n, 1_00n),
      flow("2028-01-01", 130_00n),
    ],
  },
  {
    name: "a year with deposits and no value",
    points: [
      { on: "2026-03-31", cents: 50_00n },
      { on: "2028-02-29", cents: 330_00n },
    ],
    flows: [flow("2026-01-10", 49_00n), flow("2027-05-10", 200_00n), flow("2028-01-10", 60_00n)],
  },
  {
    name: "a transfer in, an exit, and money after the last value",
    points: [
      { on: "2026-06-30", cents: 1_100_00n },
      { on: "2027-06-30", cents: 900_00n },
      { on: "2028-01-01", cents: 950_00n },
    ],
    flows: [
      flow("2026-02-01", 1_000_00n),
      flow("2027-02-01", -250_00n),
      flow("2027-08-01", 30_00n),
      flow("2028-05-01", 75_00n),
    ],
  },
  {
    name: "a first value with no money before it",
    points: [
      { on: "2026-05-15", cents: 500_00n },
      { on: "2027-05-15", cents: 620_00n },
    ],
    flows: [flow("2026-09-01", 100_00n)],
  },
];

describe("the sum of the years (funds-ux §5.2)", () => {
  it.each(HISTORIES)("adds up to All, to the cent: $name", ({ points, flows }) => {
    const years = [2025, 2026, 2027, 2028].map((year) =>
      measurePeriod({ points, flows, period: yearPeriod(year, TODAY) }),
    );
    const all = measurePeriod({ points, flows, period: allPeriod(TODAY) });
    expect(all.status).toBe("measured");
    expect(years.reduce<Cents>((sum, one) => sum + (one.gainCents ?? 0n), 0n)).toBe(all.gainCents);
    expect(years.reduce<Cents>((sum, one) => sum + (one.feesCents ?? 0n), 0n)).toBe(all.feesCents);
    expect(years.reduce<Cents>((sum, one) => sum + one.paidInCents, 0n)).toBe(all.paidInCents);
  });

  it.each(HISTORIES)("market movement − fees = gain, to the cent: $name", ({ points, flows }) => {
    for (const period of [allPeriod(TODAY), yearPeriod(2026, TODAY), yearPeriod(2027, TODAY)]) {
      const measure = measurePeriod({ points, flows, period });
      if (measure.status === "no_value") continue;
      expect(measure.marketCents! - measure.feesCents!).toBe(measure.gainCents);
    }
  });
});

describe("market movement", () => {
  it("is the value's own change, with the deposits taken out and the fees of those deposits put back", () => {
    const { points, flows } = HISTORIES[0];
    const measure = measurePeriod({ points, flows, period: allPeriod(TODAY) });
    // 410,00 − 0 − (100,00 + 140,00 + 130,00) = 40,00, after 2,00 of fees.
    expect(measure.gainCents).toBe(40_00n);
    expect(measure.feesCents).toBe(2_00n);
    expect(measure.marketCents).toBe(42_00n);
  });
});

describe("a reading of the 1st", () => {
  it("closes the month before, so January's reading closes the year before (decision 3)", () => {
    expect(closingDay("2026-12-31")).toBe("2027-01-01");
    expect(closingDay("2026-10-31")).toBe("2026-11-01");
    expect(closingDay("2026-10-30")).toBe("2026-10-30");
    const points = [
      { on: "2026-06-01", cents: 100_00n },
      { on: "2027-01-01", cents: 130_00n },
      { on: "2027-02-01", cents: 135_00n },
    ];
    const flows = [flow("2026-05-01", 100_00n)];
    const closed = measurePeriod({ points, flows, period: yearPeriod(2026, TODAY) });
    expect(closed.end).toEqual({ on: "2027-01-01", cents: 130_00n });
    expect(closed.gainCents).toBe(30_00n);
    const next = measurePeriod({ points, flows, period: yearPeriod(2027, TODAY) });
    expect(next.start).toEqual({ on: "2027-01-01", cents: 130_00n });
    expect(next.gainCents).toBe(5_00n);
  });
});

describe("the flows of a period", () => {
  it("leaves out a deposit after the value, and says so: it is no loss", () => {
    const measure = measurePeriod({
      points: [{ on: "2026-10-01", cents: 110_00n }],
      flows: [flow("2026-01-15", 100_00n), flow("2026-10-19", 25_00n)],
      period: allPeriod("2026-10-25"),
    });
    expect(measure.gainCents).toBe(10_00n);
    expect(measure.flowsCents).toBe(100_00n);
    expect(measure.paidInCents).toBe(125_00n);
    expect(measure.notInValueCents).toBe(25_00n);
  });

  it("counts a deposit on the value's own day inside the value", () => {
    const measure = measurePeriod({
      points: [{ on: "2026-10-01", cents: 101_00n }],
      flows: [flow("2026-10-01", 100_00n)],
      period: allPeriod("2026-10-25"),
    });
    expect(measure.start).toEqual({ on: "2026-09-30", cents: 0n });
    expect(measure.gainCents).toBe(1_00n);
    expect(measure.notInValueCents).toBe(0n);
  });

  it("nets a transfer in out of the gain, like any money that came in", () => {
    const [transfer] = pensionFlows([
      operation({ classification: "transfer_in", operationDate: "2026-02-01", otherCents: 1_000_00n }),
    ]);
    const measure = measurePeriod({
      points: [{ on: "2026-03-01", cents: 1_020_00n }],
      flows: [transfer],
      period: allPeriod(TODAY),
    });
    expect(measure.flowsCents).toBe(1_000_00n);
    expect(measure.gainCents).toBe(20_00n);
    expect(measure.origin.otherCents).toBe(1_000_00n);
  });

  it("adds an exit back: the money left, it was not lost", () => {
    for (const signedGross of [200_00n, -200_00n]) {
      const flows = pensionFlows([
        operation({ operationDate: "2026-02-01", workerCents: 1_000_00n }),
        operation({ classification: "withdrawal", operationDate: "2026-05-01", otherCents: signedGross }),
      ]);
      const measure = measurePeriod({
        points: [
          { on: "2026-03-01", cents: 1_000_00n },
          { on: "2026-06-01", cents: 830_00n },
        ],
        flows,
        period: yearPeriod(2026, TODAY),
      });
      expect(measure.flowsCents).toBe(800_00n);
      expect(measure.gainCents).toBe(30_00n);
      // An exit is not money paid in.
      expect(measure.paidInCents).toBe(1_000_00n);
    }
  });

  it("carries a switch's cost in the fees, and no money across the boundary", () => {
    const flows = pensionFlows([
      operation({ operationDate: "2026-02-01", workerCents: 100_00n }),
      operation({ classification: "switch", operationDate: "2026-02-10", feesCents: 5_00n }),
    ]);
    const measure = measurePeriod({
      points: [{ on: "2026-03-01", cents: 97_00n }],
      flows,
      period: allPeriod(TODAY),
    });
    expect(measure.gainCents).toBe(-3_00n);
    expect(measure.feesCents).toBe(5_00n);
    expect(measure.marketCents).toBe(2_00n);
  });

  it("marks the fees as partial when one is unknown", () => {
    const measure = measurePeriod({
      points: [{ on: "2026-03-01", cents: 300_00n }],
      flows: [flow("2026-01-10", 100_00n, 1_00n), flow("2026-02-10", 100_00n, null)],
      period: allPeriod(TODAY),
    });
    expect(measure.feesCents).toBe(1_00n);
    expect(measure.feesPartial).toBe(true);
  });
});

describe("a fund without a value", () => {
  it("has no gain, never a zero, and still says what went in", () => {
    const measure = measurePeriod({
      points: [],
      flows: [flow("2026-01-10", 100_00n, 1_00n)],
      period: yearPeriod(2026, TODAY),
    });
    expect(measure).toMatchObject({
      status: "no_value",
      gainCents: null,
      marketCents: null,
      rate: null,
      end: null,
      paidInCents: 100_00n,
      notInValueCents: 100_00n,
    });
  });

  it("has no gain in a year with no value of its own, and shows the last known value", () => {
    const measure = measurePeriod({
      points: [{ on: "2026-06-01", cents: 100_00n }],
      flows: [flow("2026-05-01", 100_00n)],
      period: yearPeriod(2027, TODAY),
    });
    expect(measure.status).toBe("no_value");
    expect(measure.gainCents).toBeNull();
    expect(measure.end).toEqual({ on: "2026-06-01", cents: 100_00n });
  });

  it("has a zero gain only when a value of the year says so", () => {
    const measure = measurePeriod({
      points: [
        { on: "2026-06-01", cents: 100_00n },
        { on: "2027-06-01", cents: 100_00n },
      ],
      flows: [flow("2026-05-01", 100_00n)],
      period: yearPeriod(2027, TODAY),
    });
    expect(measure.status).toBe("measured");
    expect(measure.gainCents).toBe(0n);
  });

  it("keeps the fees of a year with no value", () => {
    const measure = measurePeriod({
      points: [],
      flows: [flow("2026-01-10", 100_00n, 1_00n)],
      period: yearPeriod(2026, TODAY),
    });
    expect(measure.feesCents).toBeNull();
    expect(measure.feesPaidCents).toBe(1_00n);
  });

  it("takes an exit or a switch before the first value for no money in", () => {
    const flows = pensionFlows([
      operation({ classification: "withdrawal", operationDate: "2026-01-10", otherCents: 200_00n }),
      operation({ classification: "switch", operationDate: "2026-01-11", feesCents: 5_00n }),
    ]);
    const measure = measurePeriod({
      points: [{ on: "2026-02-01", cents: 1_000_00n }],
      flows,
      period: allPeriod(TODAY),
    });
    expect(measure.gainCents).toBe(0n);
  });

  it("nets a reversed contribution out of what was paid in", () => {
    const flows = pensionFlows([
      operation({ operationDate: "2026-01-10", workerCents: 100_00n }),
      operation({ operationDate: "2026-01-20", workerCents: -40_00n }),
    ]);
    const measure = measurePeriod({ points: [], flows, period: allPeriod(TODAY) });
    expect(measure.paidInCents).toBe(60_00n);
    expect(measure.origin.youCents).toBe(60_00n);
  });

  it("takes a value with no money before it as a position, not a gain", () => {
    const measure = measurePeriod({
      points: [{ on: "2026-06-01", cents: 500_00n }],
      flows: [],
      period: allPeriod(TODAY),
    });
    expect(measure.gainCents).toBe(0n);
    expect(measure.rate).toBeNull();
  });
});

describe("the rate", () => {
  it("is Modified Dietz, weighting a flow by the days left", () => {
    // 90 days from the base; 100,00 in at the start, 100,00 in 30 days before the end.
    const measure = measurePeriod({
      points: [
        { on: "2026-01-01", cents: 100_00n },
        { on: "2026-04-01", cents: 210_00n },
      ],
      flows: [flow("2026-03-02", 100_00n)],
      period: { from: "2026-01-02", to: "2026-04-01" },
    });
    expect(measure.gainCents).toBe(10_00n);
    expect(measure.rate).toBeCloseTo(10 / (100 + (100 * 30) / 90), 6);
    expect(measure.xirr).toBeNull();
  });

  it("adds the XIRR from 365 days on", () => {
    const measure = measurePeriod({
      points: [
        { on: "2026-01-01", cents: 100_00n },
        { on: "2027-01-01", cents: 110_00n },
      ],
      flows: [],
      period: { from: "2026-01-02", to: "2027-01-01" },
    });
    expect(measure.xirr).toMatchObject({ status: "ok" });
    expect((measure.xirr as { rate: number }).rate).toBeCloseTo(0.1, 4);
  });
});

describe("the documented value (funds-ux §5.2)", () => {
  const entries = [
    { on: "2026-10-31", balanceCents: 223_536n, source: "system" },
    { on: "2026-09-30", balanceCents: 225_105n, source: "system" },
    { on: "2026-09-30", balanceCents: 223_536n, source: "manual" },
    { on: "2026-09-01", balanceCents: 225_105n, source: "manual" },
    { on: "2026-08-31", balanceCents: 1n, source: "derived" },
  ];

  it("is never a system or derived copy, so a September loss stays in September", () => {
    expect(latestDocumented(entries)).toMatchObject({ on: "2026-09-30", balanceCents: 223_536n });
    expect(documentedPoints(entries)).toEqual([
      { on: "2026-09-01", cents: 225_105n },
      { on: "2026-09-30", cents: 223_536n },
    ]);
    expect(latestDocumented(entries.slice(0, 2).filter((one) => one.source === "system"))).toBeNull();
  });

  it("prefers a person's reading to an import of the same day", () => {
    expect(
      documentedEntries([
        { on: "2026-09-30", balanceCents: 2n, source: "import" },
        { on: "2026-09-30", balanceCents: 1n, source: "manual" },
      ]),
    ).toEqual([{ on: "2026-09-30", balanceCents: 1n, source: "manual" }]);
  });
});

describe("where the money comes from (§5.3)", () => {
  it("splits a pension fund's money, and a PAC's is yours", () => {
    const flows = pensionFlows([
      operation({ workerCents: 10_00n, employerCents: 20_00n, tfrCents: 50_00n, feesCents: 3_00n }),
      operation({
        classification: "enrollment",
        workerCents: 5_00n,
        employerCents: 5_00n,
        feesCents: 10_00n,
      }),
    ]);
    expect(measurePeriod({ points: [], flows, period: allPeriod(TODAY) }).origin).toEqual({
      youCents: 15_00n,
      employerCents: 25_00n,
      tfrCents: 50_00n,
      otherCents: 0n,
    });
    const pac = pacFlows([{ on: "2026-01-01", chargedCents: 40_00n, feeCents: 1_00n, source: "rule" }]);
    expect(pac[0].origin.youCents).toBe(40_00n);
  });

  it("stands on the transferred quarters when the fund has no operation of its own", () => {
    const flows = pensionFlows(
      [],
      [
        quarter({}, { worker: 10_00n, employer: 20_00n, tfr: 50_00n, enrollment: 8_00n }),
        quarter({ quarter: 2, status: "accrued_not_due", due: "2026-07-20" }, { worker: 99_00n }),
      ],
      { enrollmentCents: 2_00n, quarterCents: 3_00n },
    );
    expect(flows.map((one) => [one.on, one.chargedCents, one.feeCents, one.recurring])).toEqual([
      ["2026-04-20", 80_00n, 3_00n, true],
      ["2026-04-20", 8_00n, 2_00n, false],
    ]);
  });
});

describe("the projection (decision 8)", () => {
  const months = ["2026-01-01", "2026-02-01", "2026-03-01", "2026-04-01"];

  it("runs on the plan of a PAC, whatever went in", () => {
    const flows = pacFlows([
      { on: "2026-01-01", chargedCents: 3_250_00n, feeCents: 0n, source: "manual" },
      { on: "2026-02-17", chargedCents: 251_00n, feeCents: 1_00n, source: "rule" },
    ]);
    expect(projectionMonthly({ planCents: 251_00n, flows, months })).toBe(251_00n);
  });

  it("with no plan, averages the recurring deposits and leaves the one-offs out", () => {
    const flows = pacFlows([
      { on: "2026-01-01", chargedCents: 3_250_00n, feeCents: 0n, source: "manual" },
      { on: "2026-02-17", chargedCents: 200_00n, feeCents: 1_00n, source: "rule" },
    ]);
    expect(projectionMonthly({ planCents: null, flows, months })).toBe(50_00n);
  });

  it("on a pension fund, counts only the contributions", () => {
    const flows = pensionFlows([
      operation({ operationDate: "2026-01-20", workerCents: 400_00n }),
      operation({ classification: "enrollment", operationDate: "2026-01-20", workerCents: 1_000_00n }),
      operation({ classification: "voluntary", operationDate: "2026-02-20", workerCents: 2_000_00n }),
      operation({ classification: "transfer_in", operationDate: "2026-02-21", otherCents: 3_000_00n }),
    ]);
    expect(projectionMonthly({ planCents: null, flows, months })).toBe(100_00n);
  });
});

describe("on the way (§5.3)", () => {
  it("lists every quarter in the amount, each with its deadline", () => {
    const quarters = [
      quarter({ quarter: 3, status: "to_verify", due: "2026-10-20" }, { worker: 84_180n }),
      quarter({ quarter: 4, status: "accrued_not_due", due: "2027-01-20" }, { worker: 28_433n }),
      quarter({ quarter: 2, status: "transferred" }, { worker: 1n }),
    ];
    const { cents, quarters: pending } = onTheWay(quarters);
    expect(cents).toBe(112_613n);
    expect(pending.map((one) => [one.quarter, one.due, one.cents])).toEqual([
      [3, "2026-10-20", 84_180n],
      [4, "2027-01-20", 28_433n],
    ]);
  });
});

// `pacFlows`, `pensionFlows` and the like read as many rows as a fund has: nothing here may depend
// on the order the caller read them in.
it("does not depend on the order of the points or of the flows", () => {
  const { points, flows } = HISTORIES[0];
  const measure = (p: typeof points, f: typeof flows) =>
    measurePeriod({ points: p, flows: f, period: allPeriod(TODAY) }).gainCents;
  expect(measure([...points].reverse(), [...flows].reverse())).toBe(measure(points, flows));
});
