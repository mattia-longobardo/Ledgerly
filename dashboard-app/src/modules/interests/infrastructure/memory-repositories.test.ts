import { describe, expect, it } from "vitest";
import { MemoryInterestAccrualsRepository, MemoryInterestEntriesRepository, MemoryInterestRulesRepository } from "./memory-repositories";

function rule(overrides: Partial<Parameters<MemoryInterestRulesRepository["create"]>[0]> = {}) {
  return {
    userId: "u1", accountId: "acc-1", annualRate: "0.0225", taxRate: "0.26",
    dayCount: 365 as const, compounding: "simple_daily" as const,
    effectiveFrom: "2026-01-01", effectiveTo: null, postingMode: "analyze_only" as const,
    providerCategoryRef: null, noteMarker: "auto-interest",
    ...overrides,
  };
}

describe("MemoryInterestRulesRepository", () => {
  it("update rejects a stale version", async () => {
    const repo = new MemoryInterestRulesRepository();
    const created = await repo.create(rule());
    const result = await repo.update("u1", created.id, created.version + 1, { annualRate: "0.03" });
    expect(result).toBe("version_mismatch");
  });

  it("listActiveForAllUsers excludes a rule whose effectiveTo has passed", async () => {
    const repo = new MemoryInterestRulesRepository();
    await repo.create(rule({ effectiveTo: "2026-06-30" }));
    await repo.create(rule({ effectiveTo: null }));
    const active = await repo.listActiveForAllUsers("2026-09-05");
    expect(active).toHaveLength(1);
  });
});

describe("MemoryInterestAccrualsRepository", () => {
  it("upsert on (ruleId, accrualDate) replaces the same day rather than duplicating", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    const first = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
    const second = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });
    expect(first.id).toBe(second.id);
    expect(await repo.forRule("r1", "2026-09-01", "2026-09-02")).toHaveLength(1);
  });

  it("forRule orders by accrualDate ascending, matching the Drizzle repository's ORDER BY", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-02", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
    await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
    const rows = await repo.forRule("r1", "2026-09-01", "2026-09-03");
    expect(rows.map((r) => r.accrualDate)).toEqual(["2026-09-01", "2026-09-02"]);
  });

  it("upsert on a re-accrued day preserves postedAt/entryId set by markPosted, rather than resetting them to null (Ruling P3-16)", async () => {
    const repo = new MemoryInterestAccrualsRepository();
    const created = await repo.upsert({ ruleId: "r1", accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
    const postedAt = new Date("2026-09-02T06:00:00Z");
    await repo.markPosted(created.id, "entry-1", postedAt);

    // `runInterestAccrual` always calls `upsert` with `postedAt: null, entryId: null`
    // regardless of whether the accrual was posted earlier — the same call shape
    // a re-run of the job makes on a day it already accrued and posted.
    const reUpserted = await repo.upsert({
      ruleId: "r1",
      accrualDate: "2026-09-01",
      balanceBasis: "1200.00",
      gross: "0.09",
      tax: "0.02",
      net: "0.07",
      carryAfter: "0.000000",
      source: "computed",
      postedAt: null,
      entryId: null,
    });

    expect(reUpserted.id).toBe(created.id);
    expect(reUpserted.postedAt).toEqual(postedAt);
    expect(reUpserted.entryId).toBe("entry-1");
    expect(reUpserted.net).toBe("0.07");
  });
});

describe("MemoryInterestEntriesRepository", () => {
  it("filters listForRule by kind when given", async () => {
    const repo = new MemoryInterestEntriesRepository();
    await repo.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "projected", transactionId: null, ruleId: "r1", source: "computed" });
    await repo.create({ userId: "u1", accountId: "acc-1", occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "paid", transactionId: null, ruleId: "r1", source: "provider" });
    expect(await repo.listForRule("r1", "paid")).toHaveLength(1);
    expect(await repo.listForRule("r1")).toHaveLength(2);
  });
});
