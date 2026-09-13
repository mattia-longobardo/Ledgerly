import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { getDb } from "@/platform/db/client";
import { type Auth, applyOidcRole, createAuth } from "./auth";
import { OIDC_PROVIDER_ID } from "./provider";
import { authAccounts, users } from "./schema";

const auth = () => createAuth({ withNextCookies: false });
const PASSWORD = "correct-horse-battery";
const BASE_URL = process.env.BETTER_AUTH_URL as string;
/** RFC 9562 UUIDv7: the version nibble is 7 and the variant bits are 10xx. */
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

async function idToken(groups: string[]) {
  return new SignJWT({ groups })
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode("unused-signature-unused-signature"));
}

/** A `cookie` request header carrying every cookie the response set. */
function cookiesFrom(headers: Headers): Headers {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; "),
  });
}

async function signedIn(email: string): Promise<Headers> {
  const { headers } = await auth().api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return cookiesFrom(headers);
}

/**
 * Runs the authorization-code flow against the mock identity provider, which issues `sub` and
 * `email` equal to the subject typed at its login form. Returns the signed-in user's id, or null.
 */
async function ssoSignIn(instance: Auth, subject: string): Promise<string | null> {
  const start = await instance.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ provider: OIDC_PROVIDER_ID, callbackURL: "/" }),
    }),
  );
  const { url } = (await start.json()) as { url: string };
  const login = await fetch(url, {
    method: "POST",
    body: new URLSearchParams({ username: subject }),
    redirect: "manual",
  });
  const callback = await instance.handler(
    new Request(login.headers.get("location") as string, { headers: cookiesFrom(start.headers) }),
  );
  const session = await instance.api.getSession({ headers: cookiesFrom(callback.headers) });
  return session?.user.id ?? null;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("Better Auth configuration", () => {
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
    ).rejects.toMatchObject({ body: { code: "EMAIL_PASSWORD_SIGN_UP_DISABLED" } });
  });

  it("lets only SSO and the server-side admin API create users", async () => {
    const gate = (await auth().$context).options.user?.validateUserInfo;
    const creating = (method: string) => gate?.({ user: {}, source: { action: "create-user", method } });
    for (const method of ["email-password", "magic-link", "anonymous"]) {
      expect(await creating(method)).toEqual({
        error: "invitation_required",
        errorDescription: "An invitation is required to sign up.",
      });
    }
    expect(await creating("oauth")).toBeUndefined();
    expect(await creating("admin")).toBeUndefined();
  });

  it("signs in with the right password only", async () => {
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    const ok = await auth().api.signInEmail({ body: { email: "a@example.test", password: PASSWORD } });
    expect(ok.token).toBeTruthy();
    await expect(
      auth().api.signInEmail({ body: { email: "a@example.test", password: "wrong-password-123" } }),
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
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

describe("SSO sign-in", () => {
  it("never links a second identity to an existing user because the email matches", async () => {
    const victim = await ssoSignIn(auth(), "victim@example.test");
    expect(victim).toMatch(UUID_V7);
    expect(await ssoSignIn(auth(), "victim@example.test")).toBe(victim);
    // A different subject whose (verified) email is the victim's, up to case.
    expect(await ssoSignIn(auth(), "Victim@Example.test")).toBeNull();
    const accounts = await getDb().select({ accountId: authAccounts.accountId }).from(authAccounts);
    expect(accounts).toEqual([{ accountId: "victim@example.test" }]);
  });

  it("promotes a member of the admin group through a real SSO sign-in", async () => {
    await auth().api.createUser({ body: { email: "first@example.test", password: PASSWORD, name: "First" } });
    const member = await ssoSignIn(auth(), "user@example.test");
    const admin = await ssoSignIn(auth(), "admin@example.test");
    const roles = await getDb().select({ id: users.id, role: users.role }).from(users).orderBy(users.email);
    expect(roles).toEqual(
      expect.arrayContaining([
        { id: member, role: "user" },
        { id: admin, role: "admin" },
      ]),
    );
  });

  it("stores the provider's OAuth tokens encrypted", async () => {
    await ssoSignIn(auth(), "sso@example.test");
    const [account] = await getDb().select({ accessToken: authAccounts.accessToken }).from(authAccounts);
    expect(account.accessToken).toBeTruthy();
    expect(account.accessToken).not.toMatch(/^eyJ/);
  });

  it("refuses bare ID tokens, so only the redirect flow with PKCE and state signs in or links", async () => {
    const body = { provider: OIDC_PROVIDER_ID, idToken: { token: await idToken([]) } };
    await expect(auth().api.signInSocial({ body })).rejects.toMatchObject({
      body: { code: "ID_TOKEN_SIGN_IN_DISABLED" },
    });
    await auth().api.createUser({ body: { email: "a@example.test", password: PASSWORD, name: "A" } });
    await expect(
      auth().api.linkSocialAccount({ body, headers: await signedIn("a@example.test") }),
    ).rejects.toMatchObject({ body: { code: "ID_TOKEN_SIGN_IN_DISABLED" } });
  });
});

describe("admin permissions", () => {
  async function adminAndUser() {
    await auth().api.createUser({ body: { email: "admin@example.test", password: PASSWORD, name: "Admin" } });
    const { user } = await auth().api.createUser({
      body: { email: "user@example.test", password: PASSWORD, name: "User" },
    });
    return { headers: await signedIn("admin@example.test"), userId: user.id };
  }

  it("refuses impersonation and setting another user's password or email directly", async () => {
    const { headers, userId } = await adminAndUser();
    await expect(auth().api.impersonateUser({ body: { userId }, headers })).rejects.toMatchObject({
      body: { code: "YOU_ARE_NOT_ALLOWED_TO_IMPERSONATE_USERS" },
    });
    await expect(
      auth().api.setUserPassword({ body: { userId, newPassword: "another-password-123" }, headers }),
    ).rejects.toMatchObject({ body: { code: "YOU_ARE_NOT_ALLOWED_TO_SET_USERS_PASSWORD" } });
    await expect(
      auth().api.adminUpdateUser({ body: { userId, data: { email: "taken-over@example.test" } }, headers }),
    ).rejects.toMatchObject({ body: { code: "YOU_ARE_NOT_ALLOWED_TO_UPDATE_USERS" } });
  });

  it("keeps listing, role changes, bans, session revocation and removal", async () => {
    const { headers, userId } = await adminAndUser();
    const { users: listed } = await auth().api.listUsers({ query: { sortBy: "email" }, headers });
    expect(listed.map((user) => user.email)).toEqual(["admin@example.test", "user@example.test"]);
    await auth().api.setRole({ body: { userId, role: "admin" }, headers });
    await auth().api.banUser({ body: { userId }, headers });
    await auth().api.unbanUser({ body: { userId }, headers });
    await auth().api.revokeUserSessions({ body: { userId }, headers });
    await auth().api.removeUser({ body: { userId }, headers });
    expect(await getDb().select({ id: users.id }).from(users).where(eq(users.id, userId))).toEqual([]);
  });
});
