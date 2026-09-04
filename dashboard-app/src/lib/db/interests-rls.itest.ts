import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, interestAccruals, interestEntries, interestRules, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("interests RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own rules and entries; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) => tx.insert(accounts).values({ userId: a!.id, name: "A", type: "savings", origin: "manual" }).returning());
    const [accB] = await withSystemContext(db, (tx) => tx.insert(accounts).values({ userId: b!.id, name: "B", type: "savings", origin: "manual" }).returning());

    await withSystemContext(db, (tx) =>
      tx.insert(interestRules).values([
        { userId: a!.id, accountId: accA!.id, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" },
        { userId: b!.id, accountId: accB!.id, annualRate: "0.01", taxRate: "0.26", effectiveFrom: "2026-01-01" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(interestRules));
    expect(mine).toHaveLength(1);
    expect((await withSystemContext(db, (tx) => tx.select().from(interestRules))).length).toBe(2);
    expect(await db.select().from(interestRules)).toEqual([]);

    await withSystemContext(db, (tx) =>
      tx.insert(interestEntries).values({ userId: a!.id, accountId: accA!.id, occurredAt: new Date(), gross: "1.00", net: "0.74", kind: "projected" }),
    );
    expect((await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(interestEntries))).length).toBe(1);
    expect((await withUserContext(db, { userId: b!.id }, (tx) => tx.select().from(interestEntries))).length).toBe(0);
  });

  it("rejects a second accrual for the same rule and day", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: a!.id, name: "A", type: "savings", origin: "manual" }).returning(),
    );
    const [rule] = await withSystemContext(db, (tx) =>
      tx.insert(interestRules).values({ userId: a!.id, accountId: accA!.id, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" }).returning(),
    );
    const accrual = {
      ruleId: rule!.id,
      accrualDate: "2026-01-02",
      balanceBasis: "1000.00",
      gross: "0.061644",
      tax: "0.016027",
      net: "0.05",
      carryAfter: "0.000000",
    };
    await withSystemContext(db, (tx) => tx.insert(interestAccruals).values(accrual));

    const err: unknown = await withSystemContext(db, (tx) => tx.insert(interestAccruals).values(accrual)).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error & { cause?: Error }).cause?.message).toContain("interest_accruals_rule_date_uq");
  });

  it("a user sees only accruals reached through their own rule; the other user sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: a!.id, name: "A", type: "savings", origin: "manual" }).returning(),
    );
    const [rule] = await withSystemContext(db, (tx) =>
      tx.insert(interestRules).values({ userId: a!.id, accountId: accA!.id, annualRate: "0.0225", taxRate: "0.26", effectiveFrom: "2026-01-01" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(interestAccruals).values({
        ruleId: rule!.id,
        accrualDate: "2026-01-02",
        balanceBasis: "1000.00",
        gross: "0.061644",
        tax: "0.016027",
        net: "0.05",
        carryAfter: "0.000000",
      }),
    );

    expect((await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(interestAccruals))).length).toBe(1);
    expect((await withUserContext(db, { userId: b!.id }, (tx) => tx.select().from(interestAccruals))).length).toBe(0);
  });
});
