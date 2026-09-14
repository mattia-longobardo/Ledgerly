import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { getDb } from "@/platform/db/client";
import { createAuth } from "./auth";
import {
  acceptInvitation,
  createInvitation,
  findInvitation,
  InvitationError,
  sendInvitationEmail,
} from "./invitations";
import { users } from "./schema";

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

  it("refuses passwords over the maximum length without consuming the invitation", async () => {
    const { token } = await createInvitation({ email: "y@example.test", role: "user", invitedBy: null });
    await expect(
      acceptInvitation(auth(), { token, name: "Y", password: "a".repeat(129) }),
    ).rejects.toMatchObject({ reason: "weak_password" });
    expect(await findInvitation(token)).not.toBeNull();
  });

  it("replaces a pending invitation for the same address", async () => {
    const first = await createInvitation({ email: "x@example.test", role: "user", invitedBy: null });
    const second = await createInvitation({ email: "x@example.test", role: "admin", invitedBy: null });
    expect(await findInvitation(first.token)).toBeNull();
    expect(await findInvitation(second.token)).toMatchObject({ role: "admin" });
  });

  it("creates the account with the invited role", async () => {
    await auth().api.createUser({
      body: { email: "owner3@example.test", password: "owner-password-1", name: "Owner3" },
    });
    const { token } = await createInvitation({ email: "chief@example.test", role: "admin", invitedBy: null });
    await acceptInvitation(auth(), { token, name: "Chief", password: "chief-password-12" });
    const [row] = await getDb()
      .select({ role: users.role })
      .from(users)
      .where(eq(users.email, "chief@example.test"));
    expect(row.role).toBe("admin");
  });

  it("refuses to accept once the email is already registered", async () => {
    await auth().api.createUser({
      body: { email: "dup@example.test", password: "existing-password-1", name: "Dup" },
    });
    const { token } = await createInvitation({ email: "dup@example.test", role: "user", invitedBy: null });
    await expect(
      acceptInvitation(auth(), { token, name: "Dup2", password: "dup-password-12" }),
    ).rejects.toMatchObject({ reason: "email_taken" });
    expect(await findInvitation(token)).not.toBeNull();
  });

  it("refuses an expired invitation", async () => {
    const past = new Date("2020-01-01T00:00:00Z");
    const { token } = await createInvitation(
      { email: "old@example.test", role: "user", invitedBy: null },
      past,
    );
    await expect(
      acceptInvitation(auth(), { token, name: "Old", password: "old-password-123" }),
    ).rejects.toMatchObject({ reason: "invalid" });
  });

  it("releases the claim when account creation fails", async () => {
    const { token } = await createInvitation({ email: "z@example.test", role: "user", invitedBy: null });
    const instance = auth();
    vi.spyOn(instance.api, "createUser").mockRejectedValueOnce(new Error("boom"));
    await expect(
      acceptInvitation(instance, { token, name: "Z", password: "z-password-123" }),
    ).rejects.toThrow("boom");
    expect(await findInvitation(token)).not.toBeNull();
  });
});
