import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { DrizzleInterestRulesRepository } from "@/modules/interests/infrastructure/drizzle-interest-rules-repository";

/**
 * A6: `DrizzleInterestRulesRepository.list()` had no `ORDER BY`, while the
 * in-memory fake returns rows in stable insertion order (a plain array
 * filter never reorders on update). Without an explicit order, Postgres
 * returns physical (heap/ctid) order, and `UPDATE` writes a new heap tuple —
 * so editing one of two rules used to swap their position on reload. This
 * lives outside `src/modules/interests/` (see `interests-rls.itest.ts` for
 * the same precedent) because batch A's brief permits touching only
 * `drizzle-interest-rules-repository.ts`'s `list()` method under that
 * directory, not a colocated test file.
 */
describe("DrizzleInterestRulesRepository.list() ordering", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("keeps a stable creation-order after one of two rules is updated", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: user!.id, name: "A", type: "savings", origin: "manual" }).returning(),
    );
    const [accB] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: user!.id, name: "B", type: "savings", origin: "manual" }).returning(),
    );

    await withUserContext(db, { userId: user!.id }, async (tx) => {
      const repo = new DrizzleInterestRulesRepository(tx);
      const first = await repo.create({
        userId: user!.id,
        accountId: accA!.id,
        annualRate: "0.0225",
        taxRate: "0.26",
        dayCount: 365,
        compounding: "simple_daily",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        postingMode: "analyze_only",
        providerCategoryRef: null,
        noteMarker: "auto-interest",
      });
      const second = await repo.create({
        userId: user!.id,
        accountId: accB!.id,
        annualRate: "0.01",
        taxRate: "0.26",
        dayCount: 365,
        compounding: "simple_daily",
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        postingMode: "analyze_only",
        providerCategoryRef: null,
        noteMarker: "auto-interest",
      });

      const before = await repo.list(user!.id);
      expect(before.map((r) => r.id)).toEqual([first.id, second.id]);

      // Editing the FIRST-created rule writes a new heap tuple for it — a
      // bare `SELECT` with no `ORDER BY` would now be liable to return it
      // last, moving it past the untouched second rule.
      const updated = await repo.update(user!.id, first.id, first.version, { annualRate: "0.03" });
      expect(updated).not.toBe("version_mismatch");
      expect(updated).not.toBeNull();

      const after = await repo.list(user!.id);
      expect(after.map((r) => r.id)).toEqual([first.id, second.id]);
    });
  });
});
