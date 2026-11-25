import { and, eq, like, not } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth } from "@domain/platform/auth/auth";
import { authAccounts, users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { createTestUsers, drawPassword, type TestUser } from "../scripts/seed-e2e/users";
import { closeDatabase, resetDatabase } from "../test/db";

beforeEach(resetDatabase);
afterAll(closeDatabase);

/** The test admins who could sign in with a password alone: an admin with a password and no TOTP. */
async function adminsWithoutTotp(): Promise<string[]> {
  const rows = await getDb()
    .selectDistinct({ email: users.email })
    .from(users)
    .innerJoin(
      authAccounts,
      and(eq(authAccounts.userId, users.id), eq(authAccounts.providerId, "credential")),
    )
    .where(and(like(users.email, "%@example.test"), eq(users.role, "admin"), not(users.twoFactorEnabled)));
  return rows.map((row) => row.email);
}

const user = (name: string, extra: Partial<TestUser> = {}): TestUser => ({
  email: `${name}@example.test`,
  name,
  password: drawPassword(),
  totp: true,
  admin: false,
  ...extra,
});

describe("the e2e seed's users (scripts/seed-e2e/users.ts)", () => {
  it("never has an admin who can sign in without TOTP, on an empty database too", async () => {
    const seen: string[][] = [];
    const list = [user("owner"), user("enroll", { totp: false }), user("admin", { admin: true })];
    await createTestUsers(createAuth({ withNextCookies: false }), list, async () => {
      seen.push(await adminsWithoutTotp());
    });

    expect(seen.length).toBeGreaterThan(list.length);
    expect(seen.flat()).toEqual([]);
    const roles = await getDb()
      .select({ email: users.email, role: users.role, totp: users.twoFactorEnabled })
      .from(users)
      .orderBy(users.email);
    expect(roles).toEqual([
      { email: "admin@example.test", role: "admin", totp: true },
      { email: "enroll@example.test", role: "user", totp: false },
      { email: "owner@example.test", role: "user", totp: true },
    ]);
  });

  it("refuses an admin without TOTP and an address outside the test domain", async () => {
    const auth = createAuth({ withNextCookies: false });
    await expect(createTestUsers(auth, [user("boss", { admin: true, totp: false })])).rejects.toThrow(
      /needs TOTP/,
    );
    await expect(createTestUsers(auth, [{ ...user("x"), email: "x@example.com" }])).rejects.toThrow(
      /Not a test address/,
    );
  });

  it("draws a different password every time", () => {
    const drawn = new Set(Array.from({ length: 50 }, drawPassword));
    expect(drawn.size).toBe(50);
    expect([...drawn][0]).toMatch(/^[\w-]{32}$/);
  });
});
