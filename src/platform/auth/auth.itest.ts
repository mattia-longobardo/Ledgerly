import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { getDb } from "@/platform/db/client";
import { applyOidcRole, createAuth } from "./auth";
import { OIDC_PROVIDER_ID } from "./provider";
import { authAccounts, users } from "./schema";

const auth = () => createAuth({ withNextCookies: false });
const PASSWORD = "correct-horse-battery";
/** RFC 9562 UUIDv7: the version nibble is 7 and the variant bits are 10xx. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function idToken(groups: string[]) {
  return new SignJWT({ groups })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("unused-signature-unused-signature"));
}

describe("Better Auth configuration", () => {
  beforeEach(resetDatabase);
  afterAll(closeDatabase);

  it("makes the first user admin and later users plain users", async () => {
    const first = await auth().api.createUser({
      body: { email: "a@example.test", password: PASSWORD, name: "A" },
    });
    const second = await auth().api.createUser({
      body: { email: "b@example.test", password: PASSWORD, name: "B" },
    });
    const roles = await getDb()
      .select({ email: users.email, role: users.role })
      .from(users)
      .orderBy(users.email);
    expect(roles).toEqual([
      { email: "a@example.test", role: "admin" },
      { email: "b@example.test", role: "user" },
    ]);
    expect(first.user.id).not.toBe(second.user.id);
  });

  it("lets Postgres generate UUIDv7 ids for users and their accounts", async () => {
    const { user } = await auth().api.createUser({
      body: { email: "a@example.test", password: PASSWORD, name: "A" },
    });
    expect(user.id).toMatch(UUID_V7);
    const [account] = await getDb().select({ id: authAccounts.id }).from(authAccounts);
    expect(account.id).toMatch(UUID_V7);
  });

  it("stores the password as argon2id", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const [row] = await getDb().select({ password: authAccounts.password }).from(authAccounts);
    expect(row.password).toMatch(/^\$argon2id\$/);
  });

  it("keeps public sign-up closed", async () => {
    await expect(
      auth().api.signUpEmail({ body: { email: "x@example.test", password: PASSWORD, name: "X" } }),
    ).rejects.toThrow();
  });

  it("signs in with the right password only", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const ok = await auth().api.signInEmail({ body: { email: "a@example.test", password: PASSWORD } });
    expect(ok.token).toBeTruthy();
    await expect(
      auth().api.signInEmail({ body: { email: "a@example.test", password: "wrong-password-123" } }),
    ).rejects.toThrow();
  });

  it("promotes a member of the admin group on SSO sign-in and never demotes", async () => {
    await auth().api.createUser({ body: { email: "first@example.test", password: PASSWORD, name: "First" } });
    const { user } = await auth().api.createUser({
      body: { email: "sso@example.test", password: PASSWORD, name: "SSO" },
    });
    await applyOidcRole({
      providerId: OIDC_PROVIDER_ID,
      userId: user.id,
      idToken: await idToken(["finance-users"]),
    });
    const roleOf = async () =>
      (await getDb().select({ role: users.role }).from(users).where(eq(users.id, user.id)))[0].role;
    expect(await roleOf()).toBe("user");
    await applyOidcRole({
      providerId: OIDC_PROVIDER_ID,
      userId: user.id,
      idToken: await idToken(["finance-admins"]),
    });
    expect(await roleOf()).toBe("admin");
    await applyOidcRole({ providerId: OIDC_PROVIDER_ID, userId: user.id, idToken: await idToken([]) });
    expect(await roleOf()).toBe("admin");
  });
});
