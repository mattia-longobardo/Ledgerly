import { describe, expect, it } from "vitest";
import {
  accruedTotal,
  type CompetenceLike,
  type OperationLike,
  reconcile,
  type ReconcileInput,
} from "./reconcile";
import { COMETA_SCHEDULE, DEFAULT_TOLERANCE_DAYS } from "./rules";

/** Every amount here is invented; the shapes are the guide's cases (GC §11, §13). */

let sequence = 0;
const id = () => `id-${(sequence += 1)}`;

function competence(
  year: number,
  quarter: number,
  month: string | null,
  amounts: Partial<CompetenceLike> = {},
): CompetenceLike {
  return {
    id: id(),
    year,
    quarter,
    payrollPeriod: month,
    workerCents: 0n,
    employerCents: 0n,
    tfrCents: 0n,
    workerEnrollmentCents: null,
    employerEnrollmentCents: null,
    ...amounts,
  };
}

function operation(overrides: Partial<OperationLike> = {}): OperationLike {
  return {
    id: id(),
    classification: "contribution",
    competenceYear: 2031,
    competenceQuarter: 1,
    operationDate: "2031-04-18",
    workerCents: 0n,
    employerCents: 0n,
    tfrCents: 0n,
    otherCents: 0n,
    feesCents: 300n,
    netCents: 0n,
    units: "30.000",
    ...overrides,
  };
}

function run(input: Partial<ReconcileInput> & Pick<ReconcileInput, "today">) {
  return reconcile({
    competences: [],
    operations: [],
    decisions: [],
    schedule: COMETA_SCHEDULE,
    toleranceDays: DEFAULT_TOLERANCE_DAYS,
    freshness: null,
    ...input,
  });
}

const QUARTER_ONE = [
  competence(2031, 1, "2031-01-01", { workerCents: 2_500n, employerCents: 4_500n, tfrCents: 15_000n }),
  competence(2031, 1, "2031-02-01", { workerCents: 2_500n, employerCents: 4_500n, tfrCents: 15_000n }),
  competence(2031, 1, "2031-03-01", { workerCents: 2_500n, employerCents: 4_500n, tfrCents: 15_000n }),
];
const CREDIT_ONE = operation({
  workerCents: 7_500n,
  employerCents: 13_500n,
  tfrCents: 45_000n,
  netCents: 65_700n,
});

describe("quarter by quarter, component by component (GC §11)", () => {
  it("reconciles a quarter whose credit matches the payslips to the cent", () => {
    const [quarter] = run({ competences: QUARTER_ONE, operations: [CREDIT_ONE], today: "2031-08-31" });
    expect(quarter).toMatchObject({
      year: 2031,
      quarter: 1,
      due: "2031-04-20",
      status: "reconciled",
      invested: true,
    });
    expect(accruedTotal(quarter)).toBe(66_000n);
    expect(quarter.components.map((one) => [one.component, one.differenceCents])).toEqual([
      ["worker", 0n],
      ["employer", 0n],
      ["tfr", 0n],
    ]);
  });

  it("calls a quarter accrued and not due while its deadline has not passed", () => {
    // July and August accrued, September not yet paid: nothing is late (GC §4).
    const [quarter] = run({
      competences: [
        competence(2031, 3, "2031-07-01", { workerCents: 2_500n }),
        competence(2031, 3, "2031-08-01", { workerCents: 2_500n }),
      ],
      today: "2031-09-19",
    });
    expect(quarter).toMatchObject({
      status: "accrued_not_due",
      due: "2031-10-20",
      toleranceUntil: "2031-11-04",
    });
  });

  it("asks to verify only when an export received after the deadline still shows nothing", () => {
    const competences = [
      competence(2031, 1, "2031-01-01", { workerCents: 2_500n }),
      competence(2031, 1, "2031-02-01", { workerCents: 2_500n }),
      competence(2031, 1, "2031-03-01", { workerCents: 2_500n }),
    ];
    const stale = run({ competences, freshness: "2031-04-25", today: "2031-06-30" })[0];
    expect(stale).toMatchObject({ status: "incomplete", reason: "stale_export" });
    const fresh = run({ competences, freshness: "2031-06-29", today: "2031-06-30" })[0];
    expect(fresh.status).toBe("to_verify");
    // No export at all is not a gap in the data: the schedule says the quarter left, and nothing
    // the person was asked for is missing (owner, 2026-09-20).
    const never = run({ competences, freshness: null, today: "2031-06-30" })[0];
    expect(never).toMatchObject({ status: "transferred", reason: null });
  });

  it("calls a quarter transferred only once its deadline has passed", () => {
    const competences = [competence(2031, 1, "2031-03-01", { workerCents: 2_500n })];
    // I 2031 falls due on 20 Apr 2031; the display tolerance pushes the verdict to 5 May.
    const early = run({ competences, freshness: null, today: "2031-04-30" })[0];
    expect(early.status).toBe("accrued_not_due");
    const late = run({ competences, freshness: null, today: "2031-05-31" })[0];
    expect(late.status).toBe("transferred");
  });

  it("says data are incomplete while a payslip of the quarter is missing", () => {
    const [quarter] = run({
      competences: [QUARTER_ONE[0], QUARTER_ONE[2]],
      operations: [CREDIT_ONE],
      today: "2031-08-31",
    });
    expect(quarter).toMatchObject({
      status: "incomplete",
      reason: "missing_payslip",
      missingMonths: ["2031-02-01"],
    });
  });

  it("does not miss the months before the first payslip, nor the month still running", () => {
    const [quarter] = run({
      competences: [competence(2031, 1, "2031-03-01", { workerCents: 2_500n })],
      operations: [operation({ workerCents: 2_500n })],
      today: "2031-04-15",
    });
    expect(quarter.missingMonths).toEqual([]);
    expect(quarter.status).toBe("reconciled");
  });

  it("shows a difference as a discrepancy, and keeps it once a reviewer accepts it", () => {
    const short = operation({ workerCents: 7_000n, employerCents: 13_500n, tfrCents: 45_000n });
    const plain = run({ competences: QUARTER_ONE, operations: [short], today: "2031-08-31" })[0];
    expect(plain.status).toBe("discrepancy");
    expect(plain.components[0]).toMatchObject({ component: "worker", differenceCents: -500n });
    const accepted = run({
      competences: QUARTER_ONE,
      operations: [short],
      decisions: [
        {
          year: 2031,
          quarter: 1,
          component: "worker",
          decision: "accepted_difference",
          differenceCents: -500n,
          note: "rounded",
        },
      ],
      today: "2031-08-31",
    })[0];
    expect(accepted.status).toBe("reconciled");
    expect(accepted.components[0].decision?.note).toBe("rounded");
  });

  it("puts a decision aside once the difference it was about has changed", () => {
    const [quarter] = run({
      competences: QUARTER_ONE,
      operations: [operation({ workerCents: 7_000n, employerCents: 13_500n, tfrCents: 44_000n })],
      decisions: [
        {
          year: 2031,
          quarter: 1,
          component: "tfr",
          decision: "accepted_difference",
          differenceCents: -500n,
          note: "old",
        },
      ],
      today: "2031-08-31",
    });
    expect(quarter.components.find((one) => one.component === "tfr")).toMatchObject({
      differenceCents: -1_000n,
      decision: null,
      status: "discrepancy",
    });
  });

  it("adds up several credits and several payslips for one quarter (many to many)", () => {
    const [quarter] = run({
      competences: QUARTER_ONE,
      operations: [
        operation({ workerCents: 5_000n, employerCents: 9_000n, tfrCents: 30_000n }),
        operation({
          operationDate: "2031-05-12",
          workerCents: 2_500n,
          employerCents: 4_500n,
          tfrCents: 15_000n,
        }),
      ],
      today: "2031-08-31",
    });
    expect(quarter.status).toBe("reconciled");
    expect(quarter.operationDates).toEqual(["2031-04-18", "2031-05-12"]);
    expect(quarter.feesCents).toBe(600n);
  });

  it("keeps the enrolment out of the three components and reconciles it on its own", () => {
    const competences = QUARTER_ONE.map((one, index) =>
      index === 0 ? { ...one, workerEnrollmentCents: 516n, employerEnrollmentCents: 516n } : one,
    );
    const [quarter] = run({
      competences,
      operations: [
        CREDIT_ONE,
        operation({
          classification: "enrollment",
          workerCents: 516n,
          employerCents: 516n,
          feesCents: 1_032n,
          units: "0.000",
        }),
      ],
      today: "2031-08-31",
    });
    const enrollment = quarter.components.find((one) => one.component === "enrollment");
    expect(enrollment).toMatchObject({ accruedCents: 1_032n, creditedCents: 1_032n, status: "reconciled" });
    expect(accruedTotal(quarter)).toBe(66_000n);
  });

  it("calls a quarter the fund knows and the payslips do not 'present', 'invested' with units", () => {
    const [quarter] = run({
      operations: [operation({ competenceYear: 2030, competenceQuarter: 4, workerCents: 1_000n })],
      today: "2031-08-31",
    });
    expect(quarter.status).toBe("invested");
    const [waiting] = run({
      operations: [
        operation({ competenceYear: 2030, competenceQuarter: 4, workerCents: 1_000n, units: "0.000" }),
      ],
      today: "2031-08-31",
    });
    expect(waiting.status).toBe("present");
  });

  it("leaves operations with no competence quarter out of the reconciliation", () => {
    const quarters = run({
      competences: QUARTER_ONE,
      operations: [
        CREDIT_ONE,
        operation({
          classification: "voluntary",
          competenceYear: null,
          competenceQuarter: null,
          workerCents: 10_000n,
        }),
      ],
      today: "2031-08-31",
    });
    expect(quarters).toHaveLength(1);
    expect(quarters[0].status).toBe("reconciled");
  });
});
