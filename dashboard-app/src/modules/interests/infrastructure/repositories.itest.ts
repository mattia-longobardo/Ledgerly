import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { accountBalances, accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { closeDb, resetDb, testDb } from "@/test/db";
import type { NewInterestRule } from "../application/ports";
import { drizzleAccountBalanceLookup } from "./account-balance-lookup";
import { DrizzleInterestAccrualsRepository } from "./drizzle-interest-accruals-repository";
import { DrizzleInterestEntriesRepository } from "./drizzle-interest-entries-repository";
import { DrizzleInterestRulesRepository } from "./drizzle-interest-rules-repository";

/**
 * `accounts` carries FORCE ROW LEVEL SECURITY, so seeding it on the bare pool
 * connection (no `app.user_id`/`app.role` set) is rejected by its WITH CHECK
 * clause — matching `expenses/infrastructure/repositories.itest.ts`'s
 * precedent, which seeds through `withSystemContext`.
 */
async function seed() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Savings", type: "savings", origin: "manual" }).returning(),
  );
  return { userId: user!.id, accountId: account!.id };
}

async function seedTwoUsers() {
  const a = await seed();
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "Q" }).returning();
  const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  const [account] = await withSystemContext(db, (tx) =>
    tx.insert(accounts).values({ userId: user!.id, name: "Savings B", type: "savings", origin: "manual" }).returning(),
  );
  return { a, b: { userId: user!.id, accountId: account!.id } };
}

function newRule(userId: string, accountId: string, over: Partial<NewInterestRule> = {}): NewInterestRule {
  return {
    userId,
    accountId,
    annualRate: "0.0225",
    taxRate: "0.26",
    dayCount: 365,
    compounding: "simple_daily",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    postingMode: "analyze_only",
    providerCategoryRef: null,
    noteMarker: "auto-interest",
    ...over,
  };
}

describe("DrizzleInterestRulesRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("update rejects a stale version, matching the memory repository's contract", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const repo = new DrizzleInterestRulesRepository(tx);
      const created = await repo.create(newRule(userId, accountId));
      const result = await repo.update(userId, created.id, created.version + 1, { annualRate: "0.03" });
      expect(result).toBe("version_mismatch");
    });
  });

  it("listActiveForAllUsers excludes a rule whose effectiveTo has passed and includes an open-ended one, across users", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleInterestRulesRepository(tx);
      await repo.create(newRule(a.userId, a.accountId, { effectiveTo: "2026-06-30" }));
      const open = await repo.create(newRule(b.userId, b.accountId, { effectiveTo: null }));
      const active = await repo.listActiveForAllUsers("2026-09-05");
      expect(active.map((r) => r.id)).toEqual([open.id]);
    });
  });

  it("filters list() and get() by userId explicitly — even under a system context that bypasses RLS", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    await withSystemContext(db, async (tx) => {
      const repo = new DrizzleInterestRulesRepository(tx);
      const mine = await repo.create(newRule(a.userId, a.accountId));
      const theirs = await repo.create(newRule(b.userId, b.accountId));
      expect((await repo.list(a.userId)).map((r) => r.id)).toEqual([mine.id]);
      expect(await repo.get(a.userId, theirs.id)).toBeNull();
    });
  });
});

describe("DrizzleInterestAccrualsRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("upsert on (ruleId, accrualDate) replaces rather than duplicates", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });
      const rows = await accruals.forRule(rule.id, "2026-09-01", "2026-09-02");
      expect(rows).toHaveLength(1);
      expect(rows[0]!.carryAfter).toBe("0.000000");
    });
  });

  it("upsert on a re-accrued day preserves postedAt/entryId set by markPosted, rather than resetting them to null (Ruling P3-16)", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      const created = await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });
      const postedAt = new Date("2026-09-02T06:00:00Z");
      const entryId = crypto.randomUUID();
      await accruals.markPosted(created.id, entryId, postedAt);

      // The daily job re-upserts today's accrual with `postedAt: null, entryId:
      // null` every time it runs, even on a day it already posted — the
      // conflict path must not undo `markPosted`'s write.
      const reUpserted = await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1200.00", gross: "0.09", tax: "0.02", net: "0.07", carryAfter: "0.000000", source: "computed", postedAt: null, entryId: null });

      expect(reUpserted.id).toBe(created.id);
      expect(reUpserted.postedAt?.toISOString()).toBe(postedAt.toISOString());
      expect(reUpserted.entryId).toBe(entryId);
      expect(reUpserted.net).toBe("0.07");

      // The read path must show the same survival, not just the upsert's own return value.
      const [reread] = await accruals.forRule(rule.id, "2026-09-01", "2026-09-01");
      expect(reread!.postedAt?.toISOString()).toBe(postedAt.toISOString());
      expect(reread!.entryId).toBe(entryId);
    });
  });

  it("markPosted reports whether it affected a row — false on a mismatched id, true on a real match", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      const created = await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0.061644", tax: "0.016027", net: "0.05", carryAfter: "-0.005617", source: "computed", postedAt: null, entryId: null });

      // A wrong id must not be reported as a successful post — the caller
      // relies on this to avoid double-posting the same interest on retry.
      await expect(accruals.markPosted(crypto.randomUUID(), crypto.randomUUID(), new Date())).resolves.toBe(false);
      const [untouched] = await accruals.forRule(rule.id, "2026-09-01", "2026-09-01");
      expect(untouched!.postedAt).toBeNull();

      await expect(accruals.markPosted(created.id, crypto.randomUUID(), new Date())).resolves.toBe(true);
    });
  });

  it("forRule orders by accrualDate ascending, matching the memory repository's ORDER BY", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-02", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
      const rows = await accruals.forRule(rule.id, "2026-09-01", "2026-09-03");
      expect(rows.map((r) => r.accrualDate)).toEqual(["2026-09-01", "2026-09-02"]);
    });
  });

  it("latestCarry returns the most recent accrual by accrualDate, not insertion order", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0.01", source: "computed", postedAt: null, entryId: null });
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-03", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0.03", source: "computed", postedAt: null, entryId: null });
      await accruals.upsert({ ruleId: rule.id, accrualDate: "2026-09-02", balanceBasis: "1000.00", gross: "0", tax: "0", net: "0.00", carryAfter: "0.02", source: "computed", postedAt: null, entryId: null });
      expect(await accruals.latestCarry(rule.id)).toEqual({ accrualDate: "2026-09-03", carryAfter: "0.030000" });
    });
  });

  it("scopes accruals to their rule's owner via RLS's EXISTS join — a user context sees only its own rule's accruals, though forRule takes no userId", async () => {
    const { a, b } = await seedTwoUsers();
    const db = await testDb();
    const bRuleId = await withUserContext(db, { userId: b.userId }, async (tx) => {
      const rule = await new DrizzleInterestRulesRepository(tx).create(newRule(b.userId, b.accountId));
      await new DrizzleInterestAccrualsRepository(tx).upsert({ ruleId: rule.id, accrualDate: "2026-09-01", balanceBasis: "500.00", gross: "0.03", tax: "0.01", net: "0.02", carryAfter: "0", source: "computed", postedAt: null, entryId: null });
      return rule.id;
    });
    await withUserContext(db, { userId: a.userId }, async (tx) => {
      const accruals = new DrizzleInterestAccrualsRepository(tx);
      // `interest_accruals` has no `user_id` column of its own — this can only
      // return empty if the RLS policy's join to `interest_rules` is in force.
      expect(await accruals.forRule(bRuleId, "2026-09-01", "2026-09-02")).toEqual([]);
      expect(await accruals.latestCarry(bRuleId)).toBeNull();
    });
  });
});

describe("DrizzleInterestEntriesRepository", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("listForRule orders by occurredAt ascending and filters by kind when given", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      const rules = new DrizzleInterestRulesRepository(tx);
      const rule = await rules.create(newRule(userId, accountId));
      const entries = new DrizzleInterestEntriesRepository(tx);
      const later = await entries.create({ userId, accountId, occurredAt: new Date("2026-09-03"), gross: "1.00", net: "0.74", kind: "projected", transactionId: null, ruleId: rule.id, source: "computed" });
      const earlier = await entries.create({ userId, accountId, occurredAt: new Date("2026-09-01"), gross: "2.00", net: "1.48", kind: "paid", transactionId: null, ruleId: rule.id, source: "computed" });

      const all = await entries.listForRule(rule.id);
      expect(all.map((e) => e.id)).toEqual([earlier.id, later.id]);

      const paidOnly = await entries.listForRule(rule.id, "paid");
      expect(paidOnly.map((e) => e.id)).toEqual([earlier.id]);
    });
  });
});

describe("drizzleAccountBalanceLookup", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("returns the latest balance as of the given date (inclusive) and null when there is none yet", async () => {
    const { userId, accountId } = await seed();
    const db = await testDb();
    await withUserContext(db, { userId }, async (tx) => {
      await tx.insert(accountBalances).values([
        { accountId, asOf: "2026-08-31", balance: "900.00", available: null, source: "manual" },
        { accountId, asOf: "2026-09-01", balance: "1000.00", available: null, source: "manual" },
      ]);
      const lookup = drizzleAccountBalanceLookup(tx);
      expect(await lookup.latestBalanceAsOf(userId, accountId, "2026-09-01")).toBe("1000.00");
      expect(await lookup.latestBalanceAsOf(userId, accountId, "2026-08-31")).toBe("900.00");
      expect(await lookup.latestBalanceAsOf(userId, accountId, "2026-08-01")).toBeNull();
    });
  });
});
