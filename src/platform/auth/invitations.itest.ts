import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { clearMailbox, waitForMail } from "../../../test/mailpit";
import { createTestUser } from "../../../test/users";
import type { Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { createAuth } from "./auth";
import {
  acceptInvitation,
  completeInvitationWithSso,
  createInvitation,
  findInvitation,
  InvitationError,
  sendInvitationEmail,
} from "./invitations";
import { users } from "./schema";

const auth = () => createAuth({ withNextCookies: false });

/** A user as an SSO sign-in leaves it: no password, the given role. */
async function ssoUser(email: string, role: Role) {
  const user = await createTestUser(email);
  await getDb().update(users).set({ role }).where(eq(users.id, user.id));
  return { userId: user.id, email: user.email };
}

async function roleOf(userId: string) {
  const [row] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId));
  return row.role;
}

afterAll(closeDatabase);

describe("invitations", () => {
  beforeEach(async () => {
    await resetDatabase();
    await clearMailbox();
  });

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

describe("completing an invitation after an Authentik sign-in", () => {
  beforeEach(resetDatabase);

  it("gives the user the invited role and consumes the invitation", async () => {
    const user = await ssoUser("giulia@example.test", "user");
    const { token } = await createInvitation({
      email: "giulia@example.test",
      role: "admin",
      invitedBy: null,
    });
    expect(await completeInvitationWithSso(token, user)).toBe("accepted");
    expect(await roleOf(user.userId)).toBe("admin");
    expect(await findInvitation(token)).toBeNull();
    expect(await completeInvitationWithSso(token, user)).toBe("invalid");
  });

  it("matches the invited address regardless of case", async () => {
    const user = await ssoUser("marco@example.test", "user");
    const { token } = await createInvitation({ email: "marco@example.test", role: "admin", invitedBy: null });
    expect(await completeInvitationWithSso(token, { ...user, email: "Marco@Example.TEST" })).toBe("accepted");
    expect(await roleOf(user.userId)).toBe("admin");
  });

  it("leaves the invitation pending and the role unchanged for another address", async () => {
    const user = await ssoUser("other@example.test", "user");
    const { token } = await createInvitation({
      email: "giulia@example.test",
      role: "admin",
      invitedBy: null,
    });
    expect(await completeInvitationWithSso(token, user)).toBe("email_mismatch");
    expect(await roleOf(user.userId)).toBe("user");
    expect(await findInvitation(token)).toMatchObject({ email: "giulia@example.test", role: "admin" });
  });

  it("refuses an expired invitation", async () => {
    const user = await ssoUser("old@example.test", "user");
    const { token } = await createInvitation(
      { email: "old@example.test", role: "admin", invitedBy: null },
      new Date("2020-01-01T00:00:00Z"),
    );
    expect(await completeInvitationWithSso(token, user)).toBe("invalid");
    expect(await roleOf(user.userId)).toBe("user");
  });

  it("refuses an invitation already accepted with a password", async () => {
    const { token } = await createInvitation({ email: "luca@example.test", role: "admin", invitedBy: null });
    await acceptInvitation(auth(), { token, name: "Luca", password: "luca-password-12" });
    const [luca] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, "luca@example.test"));
    await getDb().update(users).set({ role: "user" }).where(eq(users.id, luca.id));
    expect(await completeInvitationWithSso(token, { userId: luca.id, email: "luca@example.test" })).toBe(
      "invalid",
    );
    expect(await roleOf(luca.id)).toBe("user");
  });

  it("never demotes an admin invited as a plain user", async () => {
    const user = await ssoUser("chief@example.test", "admin");
    const { token } = await createInvitation({ email: "chief@example.test", role: "user", invitedBy: null });
    expect(await completeInvitationWithSso(token, user)).toBe("accepted");
    expect(await roleOf(user.userId)).toBe("admin");
    expect(await findInvitation(token)).toBeNull();
  });

  it("refuses an unknown token", async () => {
    const user = await ssoUser("nobody@example.test", "user");
    expect(await completeInvitationWithSso("not-a-real-token", user)).toBe("invalid");
  });
});
