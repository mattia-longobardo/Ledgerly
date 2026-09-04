import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { accounts, organizations, transactions, users } from "@/lib/db/schema";
import { withSystemContext, withUserContext } from "@/platform/db/context";

describe("transactions RLS", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("a user sees only their own transactions; system sees all; no context sees none", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [a] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    const [b] = await db.insert(users).values({ organizationId: org!.id, displayName: "B" }).returning();
    const [accA] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: a!.id, name: "A cash", type: "cash", origin: "manual" }).returning(),
    );
    const [accB] = await withSystemContext(db, (tx) =>
      tx.insert(accounts).values({ userId: b!.id, name: "B cash", type: "cash", origin: "manual" }).returning(),
    );
    await withSystemContext(db, (tx) =>
      tx.insert(transactions).values([
        { userId: a!.id, accountId: accA!.id, occurredAt: new Date(), amount: "-10.00", type: "expense" },
        { userId: b!.id, accountId: accB!.id, occurredAt: new Date(), amount: "-20.00", type: "expense" },
      ]),
    );
    const mine = await withUserContext(db, { userId: a!.id }, (tx) => tx.select().from(transactions));
    expect(mine.map((r) => r.amount)).toEqual(["-10.00"]);
    expect((await withSystemContext(db, (tx) => tx.select().from(transactions))).length).toBe(2);
    expect(await db.select().from(transactions)).toEqual([]);
  });
});
