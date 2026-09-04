import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, roles, userRoles, users } from "@/lib/db/schema";
import { ownerUserId } from "./owner";

describe("ownerUserId", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("is null with no owner and the oldest active owner otherwise", async () => {
    const db = await testDb();
    expect(await ownerUserId(db)).toBeNull();
    await db.insert(roles).values({ code: "owner", label: "Owner" }).onConflictDoNothing();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [user] = await db.insert(users).values({ organizationId: org!.id, displayName: "A" }).returning();
    await db.insert(userRoles).values({ userId: user!.id, roleCode: "owner" });
    expect(await ownerUserId(db)).toBe(user!.id);
  });
});
