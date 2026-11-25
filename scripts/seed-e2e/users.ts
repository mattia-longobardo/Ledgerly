// scripts/seed-e2e/users.ts — the e2e users themselves: a password drawn for each run, TOTP, and
// the admin role last.
//
// The repo is public and the seed runs on the deployed site too, so a test user must never be a way
// in for a stranger: no password is written in the repo, and no test user is an admin who can sign
// in without TOTP at any moment of the seed (tools/e2e-seed.itest.ts).
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Auth } from "@domain/platform/auth/auth";
import { users } from "@domain/platform/auth/schema";
import { getDb } from "@domain/platform/db/client";
import { TEST_EMAIL_DOMAIN } from "../../tests/e2e/_shared/env";
import { totpCode } from "../../tests/e2e/_shared/totp";

export interface TestUser {
  email: string;
  name: string;
  password: string;
  totp: boolean;
  admin: boolean;
}

/** A password for one run only: 24 random bytes, 32 characters. */
export const drawPassword = (): string => randomBytes(24).toString("base64url");

/** A `cookie` request header from the cookies a response set. */
export function cookieHeader(headers: Headers): Headers {
  return new Headers({
    cookie: headers
      .getSetCookie()
      .map((header) => header.split(";")[0])
      .join("; "),
  });
}

/**
 * Turns TOTP on the way a person does on the setup page — password, secret, first code — so the
 * site's TWO_FACTOR_POLICY=required lets these users in. Returns the base32 secret for the specs.
 */
async function setUpTotp(auth: Auth, user: TestUser): Promise<string> {
  const { headers } = await auth.api.signInEmail({
    body: { email: user.email, password: user.password },
    returnHeaders: true,
  });
  const signedIn = cookieHeader(headers);
  const enabled = await auth.api.enableTwoFactor({ body: { password: user.password }, headers: signedIn });
  if (!("totpURI" in enabled) || !enabled.totpURI) throw new Error(`No TOTP URI for ${user.email}`);
  const secret = new URL(enabled.totpURI).searchParams.get("secret");
  if (!secret) throw new Error(`No TOTP secret for ${user.email}`);
  await auth.api.verifyTOTP({ body: { code: await totpCode(secret) }, headers: signedIn });
  return secret;
}

/**
 * Creates the users, then their TOTP, then promotes the admins. Each user is created without a
 * password, made an ordinary user and only then given one: on an empty database (a preview) the
 * first user created is made an admin, and an admin with no password cannot sign in.
 * `afterStep` runs after every write, for the test of that rule. Returns each TOTP secret by address.
 */
export async function createTestUsers(
  auth: Auth,
  list: readonly TestUser[],
  afterStep: () => Promise<void> = async () => {},
): Promise<Record<string, string>> {
  for (const user of list) {
    if (!user.email.endsWith(TEST_EMAIL_DOMAIN)) throw new Error(`Not a test address: ${user.email}`);
    if (user.admin && !user.totp) throw new Error(`An admin needs TOTP: ${user.email}`);
  }
  const context = await auth.$context;
  for (const user of list) {
    const { user: created } = await auth.api.createUser({ body: { email: user.email, name: user.name } });
    await afterStep();
    await getDb().update(users).set({ role: "user" }).where(eq(users.id, created.id));
    await afterStep();
    await context.internalAdapter.createAccount({
      userId: created.id,
      providerId: "credential",
      accountId: created.id,
      password: await context.password.hash(user.password),
    });
    await afterStep();
  }
  const secrets: Record<string, string> = {};
  for (const user of list.filter((one) => one.totp)) {
    secrets[user.email] = await setUpTotp(auth, user);
    await afterStep();
  }
  for (const user of list.filter((one) => one.admin)) {
    await getDb().update(users).set({ role: "admin" }).where(eq(users.email, user.email));
    await afterStep();
  }
  return secrets;
}
