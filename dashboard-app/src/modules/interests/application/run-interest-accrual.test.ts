import { describe, expect, it } from "vitest";
import {
  MemoryInterestAccrualsRepository,
  MemoryInterestEntriesRepository,
  MemoryInterestRulesRepository,
} from "../infrastructure/memory-repositories";
import { runInterestAccrual } from "./run-interest-accrual";

function harness(balance: string | null = "1000.00") {
  return {
    rules: new MemoryInterestRulesRepository(),
    accruals: new MemoryInterestAccrualsRepository(),
    entries: new MemoryInterestEntriesRepository(),
    balances: { latestBalanceAsOf: async () => balance },
    accounts: { ownedByUser: async () => true },
    clock: { now: () => new Date("2026-09-05T00:00:00Z") },
    audit: async () => {},
  };
}

const rule = {
  id: "r1",
  userId: "u1",
  accountId: "acc-1",
  annualRate: "0.0225",
  taxRate: "0.26",
  dayCount: 365 as const,
  compounding: "simple_daily" as const,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  postingMode: "analyze_only" as const,
  providerCategoryRef: null,
  noteMarker: "auto-interest",
  version: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("runInterestAccrual", () => {
  it("computes and stores today's accrual, carrying yesterday's remainder forward", async () => {
    const deps = harness();
    await deps.accruals.upsert({
      ruleId: "r1",
      accrualDate: "2026-09-04",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "-0.004617",
      source: "computed",
      postedAt: null,
      entryId: null,
    });
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(true);
    const rows = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    expect(rows).toHaveLength(1);
  });

  // "There was no balance to compute against" and "the interest for that day
  // was zero" are different facts (Task 18 review). A day with no balance
  // basis must be recorded as no accrual at all — never as a fabricated
  // `net: "0.00"` row, which would later reconcile as though a real,
  // computed zero had been evaluated for that day. `toHaveLength(0)` (not
  // e.g. a check on `net`) is the assertion that rules a zero-value row out
  // entirely: nothing is written for the day, full stop.
  it("does nothing and never invents a balance when the account has none on file", async () => {
    const deps = harness(null);
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(false);
    expect(await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05")).toHaveLength(0);
  });

  it("is idempotent: running twice for the same day produces one row, not two", async () => {
    const deps = harness();
    await runInterestAccrual(deps)(rule, "2026-09-05");
    await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05")).toHaveLength(1);
  });

  it("skips a rule whose compounding is not simple_daily, reporting why (Ruling P3-C44, B6)", async () => {
    const deps = harness();
    const result = await runInterestAccrual(deps)({ ...rule, compounding: "monthly" }, "2026-09-05");
    expect(result).toEqual({ accrued: false, skipReason: "unsupported_compounding" });
  });

  it("skips a rule whose dayCount is actual, reporting why (Ruling P3-C44, B6)", async () => {
    const deps = harness();
    const result = await runInterestAccrual(deps)({ ...rule, dayCount: "actual" }, "2026-09-05");
    expect(result).toEqual({ accrued: false, skipReason: "unsupported_day_count" });
  });

  it("reports no_balance as the skip reason when the account has none on file", async () => {
    const deps = harness(null);
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result).toEqual({ accrued: false, skipReason: "no_balance" });
  });

  // Ruling P3-C43 (B5): a negative balance must skip entirely — no accrual
  // row, no carry written — rather than writing a fabricated `net: "0.00"`
  // row and rolling the whole negative remainder forward, which is what
  // `dailyInterest` alone would do (see its own doc comment) and what
  // silently ate real interest for ~12 days after the balance recovered in
  // the reviewer's failure scenario.
  it("skips entirely on a negative balance, writing no accrual row and no carry", async () => {
    const deps = harness("-2000.00");
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result).toEqual({ accrued: false, skipReason: "negative_balance" });
    expect(await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05")).toHaveLength(0);
    expect(await deps.accruals.latestCarry("r1")).toBeNull();
  });

  it("a positive-balance day right after a negative-balance skip restarts the carry at zero, not a poisoned negative one", async () => {
    const deps = harness("-2000.00");
    await runInterestAccrual(deps)(rule, "2026-09-04");
    // Balance recovers the next day — the fake's fixed balance can't change
    // mid-test, so this drives the two days through two harnesses that share
    // the same accruals store instead.
    const positiveDeps = { ...deps, balances: { latestBalanceAsOf: async () => "1000.00" } };
    const result = await runInterestAccrual(positiveDeps)(rule, "2026-09-05");
    expect(result.accrued).toBe(true);
    const [row] = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    // With no trusted prior carry (the negative day wrote nothing), this is
    // the plain single-day amount on a 1000.00 balance — not a value
    // depressed by an inherited negative carry.
    expect(row!.net).toBe("0.05");
  });

  // Re-running the accrual for an already-posted day must not undo the
  // posting: `accruals.upsert` (memory + Drizzle, per Task 16) preserves
  // `postedAt`/`entryId` on conflict, and this use case must not defeat that
  // by passing anything other than null for them, or by re-posting itself.
  it("re-running for an already-posted day recomputes the numbers but leaves postedAt/entryId untouched", async () => {
    const deps = harness();
    await runInterestAccrual(deps)(rule, "2026-09-05");
    const [firstRun] = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    const postedAt = new Date("2026-09-06T06:00:00Z");
    await deps.accruals.markPosted(firstRun!.id, "entry-1", postedAt);

    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(true);
    const [rerun] = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    expect(rerun!.id).toBe(firstRun!.id);
    expect(rerun!.postedAt).toEqual(postedAt);
    expect(rerun!.entryId).toBe("entry-1");
  });

  it("restarts the sub-cent carry at zero rather than guessing across a gap in the daily chain", async () => {
    const deps = harness();
    // A carry recorded two days before the accrual date: not an unbroken chain.
    await deps.accruals.upsert({
      ruleId: "r1",
      accrualDate: "2026-09-02",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "-0.09",
      source: "computed",
      postedAt: null,
      entryId: null,
    });
    const result = await runInterestAccrual(deps)(rule, "2026-09-05");
    expect(result.accrued).toBe(true);
    const [row] = await deps.accruals.forRule("r1", "2026-09-05", "2026-09-05");
    // With a trusted carry of -0.09 folded in, net would floor to 0.00; a
    // restarted (zero) carry instead produces the plain single-day amount.
    expect(row!.net).toBe("0.05");
  });
});
