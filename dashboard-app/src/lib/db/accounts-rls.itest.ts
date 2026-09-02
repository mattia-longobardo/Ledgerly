import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("accounts RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("a user sees only their own accounts; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    await withSystemContext(db, async (tx) => {
      await tx.insert(accounts).values([
        { userId: a!.id, name: "A cash", type: "cash", origin: "manual" },
        { userId: b!.id, name: "B cash", type: "cash", origin: "manual" },
      ]);
    });
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(accounts));
    expect(mine.map((r) => r.name)).toEqual(["A cash"]);
    expect((await withSystemContext(db, (tx) => tx.select().from(accounts))).length).toBe(2);
    expect(await db.select().from(accounts)).toEqual([]);
    const promise = withUserContext(db, { userId: a!.id }, (tx) =>
      tx.insert(accounts).values({ userId: b!.id, name: "x", type: "cash", origin: "manual" }),
    );
    // drizzle-orm 0.45 wraps the pg error: the RLS message is on `.cause.message`, not `.message`.
    await expect(promise).rejects.toSatisfy((e) =>
      /row-level security/.test(String((e as { cause?: { message?: string } }).cause?.message ?? (e as Error).message)),
    );
  });
});
