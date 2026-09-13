import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { createAuth } from "./auth";
import {
  acceptInvitation,
  createInvitation,
  findInvitation,
  InvitationError,
  sendInvitationEmail,
} from "./invitations";

const auth = () => createAuth({ withNextCookies: false });

describe("invitations", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
  });
  afterAll(closeDatabase);

  it("emails a link that finds the invitation until it expires", async () => {
    const now = new Date("2026-09-13T10:00:00Z");
    const { token } = await createInvitation(
      { email: "Giulia@Example.test", role: "user", invitedBy: null },
      now,
    );
    await sendInvitationEmail({ email: "giulia@example.test", token });
    const mail = await waitForMail("giulia@example.test");
    expect(mail.Text).toContain(`/invite/${token}`);
    expect(await findInvitation(token, now)).toMatchObject({ email: "giulia@example.test", role: "user" });
    expect(await findInvitation(token, new Date("2026-09-21T10:00:00Z"))).toBeNull();
  });

  it("creates the account once and invalidates the link", async () => {
    await auth().api.createUser({
      body: { email: "owner@example.test", password: "owner-password-1", name: "Owner" },
    });
    const { token } = await createInvitation({ email: "luca@example.test", role: "user", invitedBy: null });
    const accepted = await acceptInvitation(auth(), { token, name: "Luca", password: "luca-password-12" });
    expect(accepted.email).toBe("luca@example.test");
    expect(await findInvitation(token)).toBeNull();
    await expect(
      acceptInvitation(auth(), { token, name: "Luca", password: "luca-password-12" }),
    ).rejects.toThrow(InvitationError);
    const signIn = await auth().api.signInEmail({
      body: { email: "luca@example.test", password: "luca-password-12" },
    });
    expect(signIn.token).toBeTruthy();
  });

  it("refuses weak passwords without consuming the invitation", async () => {
    const { token } = await createInvitation({ email: "x@example.test", role: "user", invitedBy: null });
    await expect(acceptInvitation(auth(), { token, name: "X", password: "short" })).rejects.toMatchObject({
      reason: "weak_password",
    });
    expect(await findInvitation(token)).not.toBeNull();
  });

  it("replaces a pending invitation for the same address", async () => {
    const first = await createInvitation({ email: "x@example.test", role: "user", invitedBy: null });
    const second = await createInvitation({ email: "x@example.test", role: "admin", invitedBy: null });
    expect(await findInvitation(first.token)).toBeNull();
    expect(await findInvitation(second.token)).toMatchObject({ role: "admin" });
  });
});
