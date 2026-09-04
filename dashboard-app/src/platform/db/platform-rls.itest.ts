import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { auditEvents, idempotencyKeys, organizations, rateLimitWindows, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("platform table RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("scopes audit, idempotency and rate-limit rows to their principal", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();

    await withSystemContext(db, async (tx) => {
      await tx.insert(auditEvents).values([
        { actorUserId: a!.id, action: "test.a", entityType: "test" },
        { actorUserId: b!.id, action: "test.b", entityType: "test" },
      ]);
      await tx.insert(idempotencyKeys).values([
        { principalId: a!.id, key: "k", requestHash: "h", expiresAt: new Date(Date.now() + 60_000) },
        { principalId: b!.id, key: "k", requestHash: "h", expiresAt: new Date(Date.now() + 60_000) },
      ]);
      await tx.insert(rateLimitWindows).values([
        { principalId: a!.id, windowStart: new Date("2026-09-04T08:00:00Z"), count: 1 },
        { principalId: b!.id, windowStart: new Date("2026-09-04T08:00:00Z"), count: 1 },
      ]);
    });

    const mineAudit = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(auditEvents));
    expect(mineAudit.map((r) => r.action)).toEqual(["test.a"]);
    const mineKeys = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(idempotencyKeys));
    expect(mineKeys).toHaveLength(1);
    const mineWindows = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(rateLimitWindows));
    expect(mineWindows).toHaveLength(1);

    const asAdmin = await withUserContext(db, { userId: a!.id, role: "admin" }, (tx) =>
      tx.select().from(auditEvents),
    );
    expect(asAdmin).toHaveLength(2);

    expect(await db.select().from(auditEvents)).toEqual([]);

    // Drizzle 0.45 wraps the pg error, so the policy name is on `cause`, never
    // on the outer message (Phase 0/1 ledger, Task 2 note). `rejects.toThrow(
    // /row-level security/)` would fail against a CORRECT implementation.
    const forged = await withUserContext(db, { userId: a!.id }, (tx) =>
      tx.insert(auditEvents).values({ actorUserId: b!.id, action: "forged", entityType: "test" }),
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(forged).toBeInstanceOf(Error);
    expect((forged as { cause?: { message?: string } }).cause?.message ?? "").toMatch(
      /row-level security/,
    );
  });
});
