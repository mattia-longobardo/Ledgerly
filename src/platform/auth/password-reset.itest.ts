import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { createAuth } from "./auth";

const auth = () => createAuth({ withNextCookies: false });

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
    await auth().api.requestPasswordReset({
      body: { email: "a@example.test", redirectTo: "/reset-password" },
    });
    const mail = await waitForMail("a@example.test");
    const token = /[?&]token=([^&\s]+)|\/reset-password\/([^?\s]+)/.exec(mail.Text);
    const value = token?.[1] ?? token?.[2];
    expect(value).toBeTruthy();
    await auth().api.resetPassword({ body: { newPassword: "new-password-123", token: value! } });
    const signIn = await auth().api.signInEmail({
      body: { email: "a@example.test", password: "new-password-123" },
    });
    expect(signIn.token).toBeTruthy();
  });
});
