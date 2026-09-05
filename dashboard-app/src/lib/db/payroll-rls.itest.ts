import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq as eqId } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import {
  organizations,
  payrollComponents,
  payrollImports,
  payrollRecords,
  users,
} from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

async function twoUsers() {
  const db = await testDb();
  const [org] = await db.insert(organizations).values({ name: "P" }).returning();
  const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
  const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
  return { db, a: a!.id, b: b!.id };
}

/**
 * drizzle-orm wraps every driver error in `DrizzleQueryError`, whose own
 * `.message` is just "Failed query: ...\nparams: ..." — the constraint name
 * lives on `.cause.message` (the raw `pg` error), same idiom as
 * `src/modules/interests/infrastructure/repositories.itest.ts`.
 */
async function rejectionCause(promise: Promise<unknown>): Promise<string | undefined> {
  const err: unknown = await promise.catch((e) => e);
  expect(err).toBeInstanceOf(Error);
  return (err as { cause?: { message?: string } }).cause?.message;
}

function anImport(userId: string, sha: string) {
  return {
    userId,
    fileName: "busta.pdf",
    sizeBytes: 1234,
    sha256: sha,
    storageProvider: "local" as const,
    storageKey: `payroll/${userId}/2026/${sha.slice(0, 32)}.pdf`,
    retentionUntil: new Date("2036-01-01T00:00:00Z"),
  };
}

describe("payroll RLS and uniqueness", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own imports; system sees all; no context sees none", async () => {
    const { db, a, b } = await twoUsers();
    await withSystemContext(db, (tx) =>
      tx.insert(payrollImports).values([anImport(a, "a".repeat(64)), anImport(b, "b".repeat(64))]),
    );
    const mine = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollImports));
    expect(mine.map((r) => r.sha256)).toEqual(["a".repeat(64)]);
    expect((await withSystemContext(db, (tx) => tx.select().from(payrollImports))).length).toBe(2);
    expect(await db.select().from(payrollImports)).toEqual([]);
  });

  it("a user cannot write an import attributed to somebody else", async () => {
    const { db, a, b } = await twoUsers();
    await expect(
      withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(b, "c".repeat(64)))),
    ).rejects.toThrow();
  });

  it("payroll_components are reachable only through their owning record", async () => {
    const { db, a, b } = await twoUsers();
    const componentId = await withSystemContext(db, async (tx) => {
      const [imp] = await tx.insert(payrollImports).values(anImport(a, "d".repeat(64))).returning();
      const [rec] = await tx
        .insert(payrollRecords)
        .values({ userId: a, importId: imp!.id, periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary" })
        .returning();
      const [comp] = await tx
        .insert(payrollComponents)
        .values({ recordId: rec!.id, code: "NETTO", labelRaw: "Netto del mese", kind: "earning", amount: "1800.00" })
        .returning();
      return comp!.id;
    });
    const asOwner = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollComponents));
    expect(asOwner.map((c) => c.id)).toEqual([componentId]);
    const asOther = await withUserContext(db, { userId: b }, (tx) => tx.select().from(payrollComponents));
    expect(asOther).toEqual([]);
  });

  it("(user_id, sha256) is unique — the same file cannot be imported twice", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64))));
    expect(
      await rejectionCause(
        withUserContext(db, { userId: a }, (tx) => tx.insert(payrollImports).values(anImport(a, "e".repeat(64)))),
      ),
    ).toMatch(/payroll_imports_user_sha_uq/);
  });

  it("(user_id, idempotency_key) is unique, and null keys do not collide", async () => {
    const { db, a } = await twoUsers();
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx.insert(payrollImports).values({ ...anImport(a, "f".repeat(64)), idempotencyKey: "k1" });
      await tx.insert(payrollImports).values({ ...anImport(a, "0".repeat(64)), idempotencyKey: null });
      await tx.insert(payrollImports).values({ ...anImport(a, "1".repeat(64)), idempotencyKey: null });
    });
    expect(
      await rejectionCause(
        withUserContext(db, { userId: a }, (tx) =>
          tx.insert(payrollImports).values({ ...anImport(a, "2".repeat(64)), idempotencyKey: "k1" }),
        ),
      ),
    ).toMatch(/payroll_imports_user_idem_uq/);
  });

  it("one import yields at most one record, and one live record per (user, period, kind)", async () => {
    const { db, a } = await twoUsers();
    const importIds = await withSystemContext(db, async (tx) => {
      const rows = await tx
        .insert(payrollImports)
        .values([anImport(a, "3".repeat(64)), anImport(a, "4".repeat(64))])
        .returning();
      return rows.map((r) => r.id);
    });
    const period = { periodStart: "2026-08-01", periodEnd: "2026-08-31", kind: "ordinary" as const };
    const firstRecordId = await withUserContext(db, { userId: a }, async (tx) => {
      const [rec] = await tx.insert(payrollRecords).values({ userId: a, importId: importIds[0]!, ...period }).returning();
      return rec!.id;
    });
    expect(
      await rejectionCause(
        withUserContext(db, { userId: a }, (tx) =>
          tx
            .insert(payrollRecords)
            .values({ userId: a, importId: importIds[0]!, ...period, periodStart: "2026-09-01", periodEnd: "2026-09-30" }),
        ),
      ),
    ).toMatch(/payroll_records_import_uq/);
    expect(
      await rejectionCause(
        withUserContext(db, { userId: a }, (tx) =>
          tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period }),
        ),
      ),
    ).toMatch(/payroll_records_period_uq/);
    // Superseding the first frees the period: the partial index only covers live rows.
    await withUserContext(db, { userId: a }, async (tx) => {
      await tx
        .update(payrollRecords)
        .set({ supersededAt: new Date() })
        .where(eqId(payrollRecords.id, firstRecordId));
      await tx.insert(payrollRecords).values({ userId: a, importId: importIds[1]!, ...period });
    });
    const live = await withUserContext(db, { userId: a }, (tx) => tx.select().from(payrollRecords));
    expect(live.filter((r) => r.supersededAt === null).length).toBe(1);
  });
});
