import { describe, expect, it } from "vitest";
import type { CivilDate } from "@/platform/dates";
import type { Cents } from "@/platform/money";
import { type FeeLike, periodFees } from "./fees";
import { type FundFlow, fundFlows, measurePeriod, yearPeriod, allPeriod } from "./period";
import type { OperationLike } from "./pension/reconcile";
import { netOfFees } from "./pension/rules";

// The "same numbers" tests of release N6 that need no database (rewrite plan,
// 11-standardization.md §11.2.4): SN3, the one flows function against the engine it replaces, and
// SN4, the fees estimated from the rows of `fund_fees` against the constants they replace. The code
// of before lives here, as it was, so that the comparison outlasts its deletion from the module.

// ——— SN3 ——————————————————————————————————————————————————————————————————————————————————————

interface Deposit {
  id: string;
  on: CivilDate;
  chargedCents: Cents;
  feeCents: Cents | null;
  source: "manual" | "rule";
}

/** The flows of a fund with a debit plan, as the engine of before N6 read its deposits. */
function flowsBefore(deposits: readonly Deposit[]): FundFlow[] {
  return deposits.map((deposit) => ({
    on: deposit.on,
    chargedCents: deposit.chargedCents,
    feeCents: deposit.feeCents,
    origin: { youCents: deposit.chargedCents, employerCents: 0n, tfrCents: 0n, otherCents: 0n },
    recurring: deposit.source === "rule",
  }));
}

/** A deposit as step A2 of the migration copies it into the one register (`0047_migrate_fund_data.sql`). */
function migrated(deposit: Deposit): OperationLike {
  return {
    id: `deposit:${deposit.id}`,
    classification: "voluntary",
    competenceYear: null,
    competenceQuarter: null,
    operationDate: deposit.on,
    workerCents: deposit.chargedCents,
    employerCents: 0n,
    tfrCents: 0n,
    otherCents: 0n,
    feesCents: deposit.feeCents ?? 0n,
    feesUnknown: deposit.feeCents === null,
    netCents: deposit.chargedCents - (deposit.feeCents ?? 0n),
    units: "0",
    source: deposit.source,
  };
}

/** Ten deposits like the ones in production: one by hand to open, nine found by the job, one fee unknown. */
const DEPOSITS: Deposit[] = [
  { id: "1", on: "2026-01-02", chargedCents: 500_000n, feeCents: 0n, source: "manual" },
  ...["02", "03", "04", "05", "06", "07", "08", "09"].map((month, index): Deposit => ({
    id: String(index + 2),
    on: `2026-${month}-05`,
    chargedCents: 25_100n,
    feeCents: 100n,
    source: "rule",
  })),
  { id: "10", on: "2026-10-05", chargedCents: 25_100n, feeCents: null, source: "rule" },
];

describe("SN3 · the flows of a migrated fund are the flows of before", () => {
  const before = flowsBefore(DEPOSITS);
  const after = fundFlows(DEPOSITS.map(migrated));

  it("has one flow per deposit, equal field by field", () => {
    expect(after).toHaveLength(before.length);
    for (const [index, flow] of after.entries()) {
      expect(flow.on).toBe(before[index].on);
      expect(flow.chargedCents).toBe(before[index].chargedCents);
      expect(flow.feeCents).toBe(before[index].feeCents);
      expect(flow.origin).toEqual(before[index].origin);
      expect(flow.recurring).toBe(before[index].recurring);
    }
    expect(after).toEqual(before);
  });

  it("gives the period engine the same measure, for a year and for all", () => {
    const points = [
      { on: "2026-03-31", cents: 551_000n },
      { on: "2026-06-30", cents: 640_500n },
      { on: "2026-11-01", cents: 742_300n },
    ];
    for (const period of [yearPeriod(2026, "2026-11-14"), allPeriod("2026-11-14")]) {
      expect(measurePeriod({ points, flows: after, period })).toEqual(
        measurePeriod({ points, flows: before, period }),
      );
    }
  });
});

// ——— SN4 ——————————————————————————————————————————————————————————————————————————————————————

/** The fees of a fund fed by the payslip before N6: 10,32 € on joining, 3 € off each quarter's transfer. */
const FEES_BEFORE = { enrollmentCents: 1_032n, quarterCents: 300n };

const row = (overrides: Partial<FeeLike>): FeeLike => ({
  basis: "one_off",
  amountCents: null,
  rate: null,
  period: null,
  sourceId: "payroll",
  component: null,
  validFrom: null,
  validTo: null,
  ...overrides,
});

/** The rows step A2 writes for that fund: the two of its rule, and the tariff's fees that are not a transfer's. */
const FEES_AFTER: FeeLike[] = [
  row({ basis: "one_off", amountCents: 1_032n }),
  row({ basis: "periodic", amountCents: 300n, period: "quarter" }),
  row({ basis: "on_assets", rate: "0.000800", period: "year", sourceId: null, validFrom: "2026-07-31" }),
  row({ basis: "on_assets", rate: "0.005800", period: "year", sourceId: null, validFrom: "2026-07-31" }),
  row({ basis: "per_request", amountCents: 1_000n, sourceId: null, validFrom: "2026-07-31" }),
  row({ basis: "per_request", amountCents: 500n, sourceId: null, validFrom: "2026-07-31" }),
];

/** Fourteen accrued periods: what each handed the fund, and the enrolment quota of the first. */
const ACCRUED: readonly { contributionCents: Cents; enrollmentCents: Cents }[] = [
  { contributionCents: 28_433n, enrollmentCents: 1_032n },
  { contributionCents: 84_180n, enrollmentCents: 0n },
  { contributionCents: 85_012n, enrollmentCents: 0n },
  { contributionCents: 84_944n, enrollmentCents: 0n },
  { contributionCents: 112_613n, enrollmentCents: 0n },
  { contributionCents: 86_100n, enrollmentCents: 0n },
  { contributionCents: 86_100n, enrollmentCents: 0n },
  { contributionCents: 87_340n, enrollmentCents: 0n },
  { contributionCents: 0n, enrollmentCents: 0n },
  { contributionCents: 87_340n, enrollmentCents: 500n },
  { contributionCents: 119_876n, enrollmentCents: 0n },
  { contributionCents: 88_021n, enrollmentCents: 0n },
  { contributionCents: 88_021n, enrollmentCents: 0n },
  { contributionCents: 88_655n, enrollmentCents: 0n },
];

describe("SN4 · the net of a payslip period with the fee rows is the net with the constants of before", () => {
  const estimate = periodFees(FEES_AFTER, { sourceId: "payroll", period: "quarter", on: "2026-11-14" });

  it("estimates the two fees of before from the rows", () => {
    expect(estimate).toEqual(FEES_BEFORE);
  });

  it("nets each of the fourteen accrued periods to the same gross, fees and net", () => {
    expect(ACCRUED).toHaveLength(14);
    for (const { contributionCents, enrollmentCents } of ACCRUED) {
      expect(netOfFees(contributionCents, enrollmentCents, estimate)).toEqual(
        netOfFees(contributionCents, enrollmentCents, FEES_BEFORE),
      );
    }
  });

  it("adds up to the same totals over the fourteen", () => {
    const total = (fees: typeof FEES_BEFORE) =>
      ACCRUED.reduce(
        (sum, one) => {
          const net = netOfFees(one.contributionCents, one.enrollmentCents, fees);
          return { fees: sum.fees + net.feesCents, net: sum.net + net.netCents };
        },
        { fees: 0n, net: 0n },
      );
    expect(total(estimate)).toEqual(total(FEES_BEFORE));
  });
});
