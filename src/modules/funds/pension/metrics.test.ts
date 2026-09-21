import { describe, expect, it } from "vitest";
import type { MonthKey } from "@/platform/dates";
import {
  bridge,
  heldAt,
  type MovementLike,
  paidInAt,
  pensionMetrics,
  sumUnits,
  valuePoints,
} from "./metrics";
import { type OperationLike, reconcile } from "./reconcile";
import { COMETA_SCHEDULE, DEFAULT_TOLERANCE_DAYS } from "./rules";

/** The twin fund of `tests/fixtures/cometa`: invented amounts that add up like the real ones. */

const operation = (overrides: Partial<OperationLike>): OperationLike => ({
  id: `op-${overrides.operationDate}-${overrides.classification ?? "contribution"}`,
  classification: "contribution",
  competenceYear: null,
  competenceQuarter: null,
  operationDate: "2031-04-18",
  workerCents: 0n,
  employerCents: 0n,
  tfrCents: 0n,
  otherCents: 0n,
  feesCents: 0n,
  netCents: 0n,
  units: "0",
  ...overrides,
});

const FIRST = operation({
  competenceYear: 2031,
  competenceQuarter: 1,
  workerCents: 7_500n,
  employerCents: 13_500n,
  tfrCents: 45_000n,
  feesCents: 300n,
  netCents: 65_700n,
  units: "30.000",
});
const ENROLLMENT = operation({
  classification: "enrollment",
  competenceYear: 2031,
  competenceQuarter: 1,
  workerCents: 516n,
  employerCents: 516n,
  feesCents: 1_032n,
  netCents: 0n,
});
const SECOND = operation({
  operationDate: "2031-07-18",
  competenceYear: 2031,
  competenceQuarter: 2,
  workerCents: 2_500n,
  employerCents: 4_500n,
  tfrCents: 15_000n,
  feesCents: 300n,
  netCents: 21_700n,
  units: "10.000",
});

const MOVEMENTS: MovementLike[] = [
  {
    operationId: FIRST.id,
    compartment: "CRESCITA",
    units: "30.000",
    unitPrice: "21.900",
    unitPriceDate: "2031-04-30",
  },
  {
    operationId: ENROLLMENT.id,
    compartment: "CRESCITA",
    units: "0.000",
    unitPrice: "21.900",
    unitPriceDate: "2031-04-30",
  },
  {
    operationId: SECOND.id,
    compartment: "CRESCITA",
    units: "5.000",
    unitPrice: "21.700",
    unitPriceDate: "2031-07-31",
  },
  {
    operationId: SECOND.id,
    compartment: "SICUREZZA",
    units: "5.000",
    unitPrice: "21.700",
    unitPriceDate: "2031-07-31",
  },
];

const COMPETENCES = [
  ...["2031-01-01", "2031-02-01", "2031-03-01"].map((month, index) => ({
    id: month,
    year: 2031,
    quarter: 1,
    payrollPeriod: month,
    workerCents: 2_500n,
    employerCents: 4_500n,
    tfrCents: 15_000n,
    workerEnrollmentCents: index === 0 ? 516n : null,
    employerEnrollmentCents: index === 0 ? 516n : null,
  })),
  {
    id: "2031-04-01",
    year: 2031,
    quarter: 2,
    payrollPeriod: "2031-04-01",
    workerCents: 2_500n,
    employerCents: 4_500n,
    tfrCents: 15_000n,
    workerEnrollmentCents: null,
    employerEnrollmentCents: null,
  },
  {
    id: "thirteenth",
    year: 2031,
    quarter: 4,
    payrollPeriod: null,
    workerCents: 500n,
    employerCents: null,
    tfrCents: null,
    workerEnrollmentCents: null,
    employerEnrollmentCents: null,
  },
];

function metricsOf(
  operations = [FIRST, ENROLLMENT, SECOND],
  value = { cents: 95_000n, on: "2031-08-31", source: "statement" as const },
) {
  const quarters = reconcile({
    competences: COMPETENCES,
    operations,
    decisions: [],
    schedule: COMETA_SCHEDULE,
    toleranceDays: DEFAULT_TOLERANCE_DAYS,
    freshness: "2031-09-01",
    today: "2031-09-19",
  });
  return pensionMetrics({ value, operations, movements: MOVEMENTS, quarters });
}

/** The owner's own case: no document of the fund's, a value recorded by hand, quarters past due. */
function payslipsOnly(value: { cents: bigint; on: string; source: "statement" | "manual" }) {
  const quarters = reconcile({
    competences: COMPETENCES,
    operations: [],
    decisions: [],
    schedule: COMETA_SCHEDULE,
    toleranceDays: DEFAULT_TOLERANCE_DAYS,
    freshness: null,
    today: "2032-03-31",
  });
  return pensionMetrics({ value, operations: [], movements: [], quarters });
}

describe("the six quantities (GC §1, §9, §12)", () => {
  it("keeps accrued, paid in, invested, value, gain and still-to-credit apart", () => {
    const metrics = metricsOf();
    expect(metrics.accruedCents).toBe(88_500n);
    expect(metrics.paidInCents).toBe(89_032n);
    expect(metrics.enrollmentCents).toBe(1_032n);
    expect(metrics.feesCents).toBe(1_632n);
    expect(metrics.investedCents).toBe(87_400n);
    expect(metrics.value).toMatchObject({ cents: 95_000n, on: "2031-08-31" });
    expect(metrics.gainCents).toBe(5_968n);
    expect(metrics.gainFraction).toBeCloseTo(0.067, 3);
    expect(metrics.pendingCents).toBe(500n);
    expect(metrics.pending).toEqual([{ year: 2031, quarter: 4, due: "2032-01-20", cents: 500n }]);
    expect(metrics.coveredUntil).toBe("2031-06-01");
    expect(metrics.units).toBe("40.000");
    expect(metrics.lastPrice).toEqual({ price: "21.700", on: "2031-07-31" });
  });

  it("reconciles the numbers that differ, to the cent (GC §12)", () => {
    const lines = bridge(metricsOf())!;
    expect(lines.map((line) => [line.key, line.cents])).toEqual([
      ["accrued", 88_500n],
      ["pending", -500n],
      ["enrollment", 1_032n],
      ["paidIn", 89_032n],
      ["fees", -1_632n],
      ["invested", 87_400n],
      ["market", 7_600n],
      ["value", 95_000n],
    ]);
  });

  it("says why a figure cannot be computed instead of showing a number", () => {
    const metrics = metricsOf([FIRST, ENROLLMENT, SECOND], null as never);
    expect(metrics.gainCents).toBeNull();
    expect(metrics.gainReason).toBe("no_value");
    expect(metrics.gainFraction).toBeNull();
    expect(bridge(metrics)).toBeNull();
    const nothing = pensionMetrics({
      value: { cents: 0n, on: "2031-08-31", source: "manual" },
      operations: [],
      movements: [],
      quarters: [],
    });
    expect(nothing.gainReason).toBe("nothing_paid");
    expect(nothing.gainFraction).toBeNull();
  });

  it("does not count a credit later than the value as a loss (GC §13)", () => {
    const late = operation({
      operationDate: "2031-09-15",
      competenceYear: 2031,
      competenceQuarter: 3,
      workerCents: 5_000n,
      netCents: 5_000n,
    });
    const metrics = metricsOf([FIRST, ENROLLMENT, SECOND, late]);
    expect(metrics.paidInCents).toBe(89_032n);
    expect(metrics.laterCents).toBe(5_000n);
    expect(metrics.gainCents).toBe(5_968n);
  });

  it("treats a transfer in as capital, never as a gain, and a withdrawal as capital out (GC §13)", () => {
    const transfer = operation({
      operationDate: "2031-08-20",
      classification: "transfer_in",
      otherCents: 100_000n,
      netCents: 99_000n,
      feesCents: 1_000n,
    });
    const withdrawal = operation({
      operationDate: "2031-08-22",
      classification: "withdrawal",
      otherCents: -20_000n,
      netCents: -21_000n,
      feesCents: 1_000n,
    });
    const metrics = metricsOf([FIRST, ENROLLMENT, SECOND, transfer, withdrawal], {
      cents: 175_000n,
      on: "2031-08-31",
      source: "statement",
    });
    expect(metrics.transfersInCents).toBe(100_000n);
    expect(metrics.withdrawalsCents).toBe(20_000n);
    // 1750.00 − 890.32 − 1000.00 + 200.00 = 59.68: the transfer added no gain at all.
    expect(metrics.gainCents).toBe(5_968n);
  });

  it("adds units up without inventing precision (GC §13)", () => {
    expect(sumUnits(["20.802", "30.926", "30.427"])).toBe("82.155");
    expect(sumUnits(["1.5", "2.25"])).toBe("3.750");
    expect(sumUnits(["30.000000", "10.000000"])).toBe("40.000");
    expect(sumUnits([])).toBeNull();
  });

  it("draws only documented points, held between them (GC §5)", () => {
    const points = valuePoints([{ on: "2031-08-31", cents: 95_000n }], MOVEMENTS);
    expect(points).toEqual([
      { on: "2031-04-30", cents: 65_700n, kind: "units" },
      { on: "2031-07-31", cents: 86_800n, kind: "units" },
      { on: "2031-08-31", cents: 95_000n, kind: "statement" },
    ]);
    const months = ["2031-03-01", "2031-04-01", "2031-05-01", "2031-06-01", "2031-07-01", "2031-08-01"];
    expect(heldAt(points, months)).toEqual([null, 65_700n, 65_700n, 65_700n, 86_800n, 95_000n]);
    expect(paidInAt([FIRST, ENROLLMENT, SECOND], months)).toEqual([
      0n,
      67_032n,
      67_032n,
      67_032n,
      89_032n,
      89_032n,
    ]);
  });

  /*
    A fund fed by the payslips alone: no operation of the fund's ever imported, a value written by
    hand. The gain is what the value exceeds the money the transfer schedule has already carried —
    measuring it against a zero made the whole position read as gain (owner, 2026-09-20).
  */
  describe("a fund with no document of its own", () => {
    it("measures the gain against what the schedule has carried by the value's date", () => {
      const metrics = payslipsOnly({ cents: 100_000n, on: "2032-01-31", source: "manual" });
      // Only I 2031 is a whole quarter here: II and IV are missing payslips of their own, so they
      // are incomplete data and nothing says they were carried.
      expect(metrics.transferredCents).toBe(66_000n);
      expect(metrics.standsOnPayslips).toBe(true);
      expect(metrics.paidInCents).toBe(0n);
      expect(metrics.gainBasisCents).toBe(66_000n);
      expect(metrics.gainCents).toBe(34_000n);
      expect(metrics.gainFraction).toBeCloseTo(34_000 / 66_000, 6);
    });

    it("draws the paid-in line stepping at each deadline, not flat at zero", () => {
      const quarters = reconcile({
        competences: COMPETENCES,
        operations: [],
        decisions: [],
        schedule: COMETA_SCHEDULE,
        toleranceDays: DEFAULT_TOLERANCE_DAYS,
        freshness: null,
        today: "2032-03-31",
      });
      const months: MonthKey[] = ["2031-03-01", "2031-04-01", "2031-05-01"];
      // I 2031 lands on 20 Apr 2031: nothing in March, 66 000 from April on.
      expect(paidInAt([], months, quarters)).toEqual([0n, 66_000n, 66_000n]);
      // With an operation of its own the fund's own figures win: `FIRST` is worth the same 66 000,
      // so adding the stand-in on top of it would read 132 000 here.
      expect(paidInAt([FIRST], months, quarters)).toEqual([0n, 66_000n, 66_000n]);
    });

    it("leaves a quarter carried after the value's date out of the gain", () => {
      // I 2031 falls due on 20 Apr 2031: a value dated the day before cannot contain it, so
      // nothing is known to be inside that value and it is a position, not a gain.
      const metrics = payslipsOnly({ cents: 100_000n, on: "2031-04-19", source: "manual" });
      expect(metrics.transferredCents).toBe(66_000n);
      expect(metrics.gainBasisCents).toBe(0n);
      expect(metrics.gainCents).toBeNull();
      expect(metrics.gainReason).toBe("nothing_paid");
    });

    it("calls the value a position and not a gain when nothing is known to have gone in", () => {
      const quarters = reconcile({
        competences: [],
        operations: [],
        decisions: [],
        schedule: COMETA_SCHEDULE,
        toleranceDays: DEFAULT_TOLERANCE_DAYS,
        freshness: null,
        today: "2032-03-31",
      });
      const metrics = pensionMetrics({
        value: { cents: 225_105n, on: "2026-09-01", source: "manual" },
        operations: [],
        movements: [],
        quarters,
      });
      expect(metrics.gainBasisCents).toBe(0n);
      expect(metrics.gainCents).toBeNull();
      expect(metrics.gainReason).toBe("nothing_paid");
    });
  });
});
