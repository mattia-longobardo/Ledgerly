import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, resetDb, testDb } from "@/test/db";
import { organizations, userIdentities, userRoles, users } from "@/lib/db/schema";
import { resolvePrincipal } from "./principal";

describe("resolvePrincipal", () => {
  beforeEach(resetDb);
  afterAll(closeDb);
  it("maps an identity to roles and permissions; unknown identity is null", async () => {
    const db = await testDb();
    const [org] = await db.insert(organizations).values({ name: "P" }).returning();
    const [u] = await db.insert(users).values({ organizationId: org!.id, displayName: "O" }).returning();
    await db.insert(userIdentities).values({ userId: u!.id, provider: "authentik", subject: "s1" });
    await db.execute(sql`INSERT INTO roles (code, label) VALUES ('member', 'Member') ON CONFLICT DO NOTHING`);
    await db.insert(userRoles).values({ userId: u!.id, roleCode: "member" });

    const p = await resolvePrincipal(db, { provider: "authentik", subject: "s1" });
    expect(p?.roles).toEqual(["member"]);
    expect(p?.permissions.has("accounts.write")).toBe(true);
    expect(await resolvePrincipal(db, { provider: "authentik", subject: "nope" })).toBeNull();
  });
});
