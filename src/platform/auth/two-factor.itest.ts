import { base32 } from "@better-auth/utils/base32";
import { createOTP } from "@better-auth/utils/otp";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { getDb } from "@/platform/db/client";
import { createAuth } from "./auth";
import { sessions, twoFactors, users } from "./schema";

// TOTP for password accounts (docs/auth-design.md D2), against the real plugin and database: the
// setup, the sign-in challenge, recovery codes, the per-challenge limit and the account lockout.

const auth = () => createAuth({ withNextCookies: false });
const PASSWORD = "correct-horse-battery";
const EMAIL = "totp@example.test";

function cookiesFrom(headers: Headers, previous?: Headers): Headers {
  const jar = new Map<string, string>();
  for (const pair of (previous?.get("cookie") ?? "").split("; ").filter(Boolean)) {
    const [name, ...value] = pair.split("=");
    jar.set(name, value.join("="));
  }
  for (const cookie of headers.getSetCookie()) {
    const [pair, ...attributes] = cookie.split(";");
    const [name, ...value] = pair.split("=");
    const expired = attributes.some((attribute) => /max-age=0/i.test(attribute.trim()));
    if (expired || value.join("=") === "") jar.delete(name);
    else jar.set(name, value.join("="));
  }
  return new Headers({ cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; ") });
}

const hasSession = (headers: Headers) => /session_token=/.test(headers.get("cookie") ?? "");

async function passwordSignIn(): Promise<{ headers: Headers; body: Record<string, unknown> }> {
  const { headers, response } = await auth().api.signInEmail({
    body: { email: EMAIL, password: PASSWORD },
    returnHeaders: true,
  });
  return { headers: cookiesFrom(headers), body: response as Record<string, unknown> };
}

/** The base32 secret from the otpauth URI, as an authenticator app reads it. */
function secretOf(totpURI: string): string {
  return new URL(totpURI).searchParams.get("secret") as string;
}

/** What an authenticator app shows: the URI carries the secret in base32. */
const codeFor = (secret: string) => createOTP(base32.decode(secret)).totp();

/** A six-digit code that is not the current one (nor, in practice, a neighbouring window's). */
async function wrongCodeFor(secret: string): Promise<string> {
  const right = await codeFor(secret);
  return right
    .split("")
    .map((digit) => String((Number(digit) + 5) % 10))
    .join("");
}

/** A user with TOTP on: signs in, sets it up, confirms it. Returns the secret and recovery codes. */
async function enrolled(): Promise<{ secret: string; backupCodes: string[] }> {
  await auth().api.createUser({ body: { email: EMAIL, password: PASSWORD, name: "Totp" } });
  const { headers } = await passwordSignIn();
  const enabled = await auth().api.enableTwoFactor({ body: { password: PASSWORD }, headers });
  if (!("totpURI" in enabled) || !enabled.totpURI || !enabled.backupCodes) throw new Error("no TOTP URI");
  const secret = secretOf(enabled.totpURI);
  await auth().api.verifyTOTP({ body: { code: await codeFor(secret) }, headers });
  return { secret, backupCodes: enabled.backupCodes };
}

async function userRow() {
  const [row] = await getDb()
    .select({ id: users.id, twoFactorEnabled: users.twoFactorEnabled })
    .from(users)
    .where(eq(users.email, EMAIL));
  return row;
}

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("TOTP setup", () => {
  it("turns TOTP on only after a code confirms the secret, and stores the secret encrypted", async () => {
    await auth().api.createUser({ body: { email: EMAIL, password: PASSWORD, name: "Totp" } });
    const { headers } = await passwordSignIn();

    await expect(
      auth().api.enableTwoFactor({ body: { password: "not-the-password" }, headers }),
    ).rejects.toMatchObject({ body: { code: "INVALID_PASSWORD" } });

    const enabled = await auth().api.enableTwoFactor({ body: { password: PASSWORD }, headers });
    if (!("totpURI" in enabled) || !enabled.totpURI) throw new Error("no TOTP URI");
    const secret = secretOf(enabled.totpURI);
    expect(enabled.totpURI).toMatch(/^otpauth:\/\/totp\/Ledgerly:/);
    expect(enabled.backupCodes).toHaveLength(10);

    const [stored] = await getDb().select().from(twoFactors);
    expect(stored.verified).toBe(false);
    expect(stored.secret).not.toContain(secret);
    for (const code of enabled.backupCodes ?? []) expect(stored.backupCodes).not.toContain(code);
    expect((await userRow()).twoFactorEnabled).toBe(false);

    await auth().api.verifyTOTP({ body: { code: await codeFor(secret) }, headers });
    expect((await userRow()).twoFactorEnabled).toBe(true);
    const [confirmed] = await getDb().select({ verified: twoFactors.verified }).from(twoFactors);
    expect(confirmed.verified).toBe(true);
  });
});

describe("password sign-in with TOTP", () => {
  it("opens no session until the code, then opens one", async () => {
    const { secret } = await enrolled();
    const { headers, body } = await passwordSignIn();
    expect(body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ["totp"] });
    expect(hasSession(headers)).toBe(false);

    const verified = await auth().api.verifyTOTP({
      body: { code: await codeFor(secret) },
      headers,
      returnHeaders: true,
    });
    expect(hasSession(cookiesFrom(verified.headers))).toBe(true);
  });

  it("ends the challenge after five wrong codes", async () => {
    const { secret } = await enrolled();
    const { headers } = await passwordSignIn();
    const wrong = await wrongCodeFor(secret);
    for (let attempt = 0; attempt < 5; attempt++) {
      await expect(auth().api.verifyTOTP({ body: { code: wrong }, headers })).rejects.toMatchObject({
        body: { code: "INVALID_CODE" },
      });
    }
    await expect(
      auth().api.verifyTOTP({ body: { code: await codeFor(secret) }, headers }),
    ).rejects.toMatchObject({ body: { code: "TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE" } });
  });

  it("locks the account's second factor after ten wrong codes in a row, across challenges", async () => {
    const { secret } = await enrolled();
    const wrong = await wrongCodeFor(secret);
    for (let challenge = 0; challenge < 2; challenge++) {
      const { headers } = await passwordSignIn();
      for (let attempt = 0; attempt < 5; attempt++) {
        await expect(auth().api.verifyTOTP({ body: { code: wrong }, headers })).rejects.toMatchObject({
          body: { code: "INVALID_CODE" },
        });
      }
    }
    const { headers } = await passwordSignIn();
    await expect(
      auth().api.verifyTOTP({ body: { code: await codeFor(secret) }, headers }),
    ).rejects.toMatchObject({ body: { code: "ACCOUNT_TEMPORARILY_LOCKED" } });
    const [row] = await getDb().select({ lockedUntil: twoFactors.lockedUntil }).from(twoFactors);
    expect(row.lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it("accepts each recovery code once", async () => {
    const { backupCodes } = await enrolled();
    const first = await passwordSignIn();
    const verified = await auth().api.verifyBackupCode({
      body: { code: backupCodes[0] },
      headers: first.headers,
      returnHeaders: true,
    });
    expect(hasSession(cookiesFrom(verified.headers))).toBe(true);

    const second = await passwordSignIn();
    await expect(
      auth().api.verifyBackupCode({ body: { code: backupCodes[0] }, headers: second.headers }),
    ).rejects.toMatchObject({ body: { code: "INVALID_BACKUP_CODE" } });
  });

  it("skips the code on a trusted device", async () => {
    const { secret } = await enrolled();
    const { headers } = await passwordSignIn();
    const verified = await auth().api.verifyTOTP({
      body: { code: await codeFor(secret), trustDevice: true },
      headers,
      returnHeaders: true,
    });
    const trusted = cookiesFrom(verified.headers, headers);
    const again = await auth().api.signInEmail({
      body: { email: EMAIL, password: PASSWORD },
      headers: trusted,
      returnHeaders: true,
    });
    expect(again.response).not.toHaveProperty("twoFactorRedirect");
    expect(hasSession(cookiesFrom(again.headers))).toBe(true);
  });
});

describe("turning TOTP off", () => {
  it("asks for the password, then removes the secret", async () => {
    const { secret } = await enrolled();
    const { headers: challenge } = await passwordSignIn();
    const verified = await auth().api.verifyTOTP({
      body: { code: await codeFor(secret) },
      headers: challenge,
      returnHeaders: true,
    });
    const headers = cookiesFrom(verified.headers);
    await expect(
      auth().api.disableTwoFactor({ body: { password: "not-the-password" }, headers }),
    ).rejects.toMatchObject({ body: { code: "INVALID_PASSWORD" } });
    await auth().api.disableTwoFactor({ body: { password: PASSWORD }, headers });
    expect((await userRow()).twoFactorEnabled).toBe(false);
    expect(await getDb().select().from(twoFactors)).toHaveLength(0);
    expect(await getDb().select().from(sessions)).not.toHaveLength(0);
  });
});
