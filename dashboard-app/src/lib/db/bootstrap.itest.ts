import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import { bootstrapOwner } from "@/lib/db/bootstrap";
import { organizations, roles, userIdentities, userRoles, users } from "@/lib/db/schema";

describe("bootstrapOwner", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("creates the owner once and is a no-op on a second call with a different subject", async () => {
    const db = await testDb();
    // resetDb truncates the migration's seed rows, so the org and the owner role must be seeded here.
    await db.insert(organizations).values({ name: "Personal" });
    await db.insert(roles).values({ code: "owner", label: "Owner" });

    const first = await bootstrapOwner(db, { subject: "sub-1", email: "owner@example.com" });
    expect(first).toEqual({ created: true });

    const allUsers = await db.select().from(users);
    expect(allUsers).toHaveLength(1);
    const owner = allUsers[0]!;

    const grantedRoles = await db.select().from(userRoles).where(eq(userRoles.userId, owner.id));
    expect(grantedRoles).toHaveLength(1);
    expect(grantedRoles[0]?.roleCode).toBe("owner");

    const identities = await db.select().from(userIdentities).where(eq(userIdentities.userId, owner.id));
    expect(identities).toHaveLength(1);
    expect(identities[0]?.provider).toBe("authentik");
    expect(identities[0]?.subject).toBe("sub-1");

    const second = await bootstrapOwner(db, { subject: "sub-2", email: "someone-else@example.com" });
    expect(second).toEqual({ created: false });

    const usersAfter = await db.select().from(users);
    expect(usersAfter).toHaveLength(1);

    const identitiesAfter = await db.select().from(userIdentities).where(eq(userIdentities.userId, owner.id));
    expect(identitiesAfter).toHaveLength(1);
    expect(identitiesAfter[0]?.subject).toBe("sub-1");
  });
});
