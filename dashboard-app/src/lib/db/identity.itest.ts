import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, userIdentities, users } from "@/lib/db/schema";

describe("identity schema", () => {
  beforeEach(resetDb);
  afterAll(closeDb);

  it("stores a user with an OIDC identity and rejects a duplicate subject", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "Personal" }).returning();
    const [user] = await db
      .insert(users)
      .values({ organizationId: org!.id, displayName: "Owner" })
      .returning();
    await db.insert(userIdentities).values({ userId: user!.id, provider: "authentik", subject: "sub-1" });
    // drizzle-orm wraps the pg error: the constraint name is on `.cause`, not `.message`.
    const duplicate: unknown = await db
      .insert(userIdentities)
      .values({ userId: user!.id, provider: "authentik", subject: "sub-1" })
      .catch((e: unknown) => e);
    expect(duplicate).toBeInstanceOf(Error);
    expect(String((duplicate as Error).cause)).toMatch(/user_identities_provider_subject_uq/);
    const [stored] = await db.select().from(users).where(eq(users.id, user!.id));
    expect(stored?.status).toBe("active");
  });
});
