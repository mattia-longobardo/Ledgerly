import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, hasMail, waitForMail } from "../../../test/mailpit";
import { createTestUser } from "../../../test/users";
import { DEFAULT_PREFERENCES } from "@/modules/users/rules";
import { updatePreferences } from "@/modules/users/service";
import { getDb } from "@/platform/db/client";
import { createAuth } from "./auth";
import { OIDC_PROVIDER_ID } from "./provider";
import { authAccounts, verifications } from "./schema";

const auth = () => createAuth({ withNextCookies: false });

const requestReset = (email: string) =>
  auth().api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });

describe("password reset", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
  });
  afterAll(closeDatabase);

  it("emails a reset link whose token sets a new password", async () => {
    await auth().api.createUser({
      body: { email: "a@example.test", password: "old-password-123", name: "A" },
    });
    await requestReset("a@example.test");
    const mail = await waitForMail("a@example.test");
    expect(mail.Subject).toBe("Reset your Finance Dashboard password");
    const token = /[?&]token=([^&\s]+)|\/reset-password\/([^?\s]+)/.exec(mail.Text);
    const value = token?.[1] ?? token?.[2];
    expect(value).toBeTruthy();

    const [verification] = await getDb().select({ identifier: verifications.identifier }).from(verifications);
    expect(verification.identifier).not.toBe(`reset-password:${value}`);
    expect(verification.identifier).not.toContain(value!);

    await auth().api.resetPassword({ body: { newPassword: "new-password-123", token: value! } });
    const signIn = await auth().api.signInEmail({
      body: { email: "a@example.test", password: "new-password-123" },
    });
    expect(signIn.token).toBeTruthy();
  });

  it("writes the email in the user's preferred language", async () => {
    const { user } = await auth().api.createUser({
      body: { email: "it@example.test", password: "old-password-123", name: "It" },
    });
    await updatePreferences({ userId: user.id }, { ...DEFAULT_PREFERENCES, locale: "it" });
    await requestReset("it@example.test");
    expect((await waitForMail("it@example.test")).Subject).toBe("Reimposta la password di Finance Dashboard");
  });

  it("sends an Authentik-only user no link, so they never gain a password", async () => {
    const sso = await createTestUser("sso@example.test");
    await getDb()
      .insert(authAccounts)
      .values({ userId: sso.id, providerId: OIDC_PROVIDER_ID, accountId: "sso" });
    await auth().api.createUser({
      body: { email: "a@example.test", password: "old-password-123", name: "A" },
    });

    const answer = await requestReset("sso@example.test");
    expect(answer).toEqual(await requestReset("a@example.test"));
    // The Authentik-only request went first: once the password user's email is in, the other is not coming.
    await waitForMail("a@example.test");
    expect(await hasMail("sso@example.test")).toBe(false);

    const accounts = await getDb()
      .select({ providerId: authAccounts.providerId })
      .from(authAccounts)
      .where(eq(authAccounts.userId, sso.id));
    expect(accounts).toEqual([{ providerId: OIDC_PROVIDER_ID }]);
  });
});
