import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { authAccounts, invitations, sessions, users } from "@/platform/auth/schema";
import type { Ctx, Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { getObject, putObject } from "@/platform/storage";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { createTestUser } from "../../../test/users";
import {
  AdminError,
  invitePerson,
  listPeople,
  removePerson,
  revokeInvitation,
  sendPersonReset,
  setPersonBlocked,
  setPersonRole,
} from "./admin";

function contextFor(userId: string, role: Role = "admin"): Ctx {
  return { userId, role, locale: "en", timeZone: "Europe/Rome", numberFormat: "it-IT" };
}

async function person(role: Role = "user") {
  const row = await createTestUser();
  if (role === "admin") await getDb().update(users).set({ role }).where(eq(users.id, row.id));
  return row;
}

async function giveAccount(userId: string, providerId: "credential" | "authentik") {
  await getDb().insert(authAccounts).values({ userId, accountId: randomUUID(), providerId, password: "x" });
}

async function roleOf(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ role: users.role }).from(users).where(eq(users.id, userId));
  return row?.role ?? null;
}

/** A mail transport that works, so these tests are about invitations and not about SMTP. */
const POSTED = { sendInvitationEmail: async () => "sent" as const };

beforeEach(resetDatabase);
afterAll(closeDatabase);

describe("listPeople", () => {
  it("refuses anyone who is not an admin", async () => {
    const someone = await person();
    await expect(listPeople(contextFor(someone.id, "user"))).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  it("names how each person signs in, when they last did, and marks the reader's own row", async () => {
    const admin = await person("admin");
    await giveAccount(admin.id, "credential");
    await giveAccount(admin.id, "authentik");
    const signedIn = new Date("2026-09-20T08:00:00Z");
    await getDb()
      .insert(sessions)
      .values({
        userId: admin.id,
        token: "session-token",
        createdAt: signedIn,
        expiresAt: new Date("2026-10-20T08:00:00Z"),
      });
    const other = await person();
    await giveAccount(other.id, "authentik");

    const rows = await listPeople(contextFor(admin.id));
    const mine = rows.find((row) => row.id === admin.id)!;
    expect(mine).toMatchObject({ kind: "user", method: "both", role: "admin", self: true });
    expect(mine.lastSignInAt?.toISOString()).toBe(signedIn.toISOString());
    expect(rows.find((row) => row.id === other.id)).toMatchObject({
      method: "sso",
      role: "user",
      self: false,
      lastSignInAt: null,
      status: "active",
    });
  });

  it("lists a pending invitation after the users, and its expiry decides its status", async () => {
    const admin = await person("admin");
    await invitePerson(contextFor(admin.id), { email: "new@example.test", role: "user" }, POSTED);
    await getDb()
      .update(invitations)
      .set({ expiresAt: new Date("2020-01-01T00:00:00Z") })
      .where(eq(invitations.email, "new@example.test"));

    const rows = await listPeople(contextFor(admin.id));
    expect(rows.at(-1)).toMatchObject({
      kind: "invitation",
      email: "new@example.test",
      method: "invited",
      status: "expired",
    });
  });
});

describe("inviting", () => {
  it("creates an invitation and reports that the email left", async () => {
    const admin = await person("admin");
    expect(
      await invitePerson(contextFor(admin.id), { email: "New@Example.test", role: "admin" }, POSTED),
    ).toBe("sent");
    const [row] = await getDb().select().from(invitations);
    expect(row).toMatchObject({ email: "new@example.test", role: "admin", invitedBy: admin.id });
    expect(row.acceptedAt).toBeNull();
  });

  it("keeps the invitation when the mail server refuses it, and says so", async () => {
    const admin = await person("admin");
    const outcome = await invitePerson(
      contextFor(admin.id),
      { email: "new@example.test", role: "user" },
      {
        sendInvitationEmail: async () => {
          throw new Error("connect ECONNREFUSED 127.0.0.1:9");
        },
      },
    );
    expect(outcome).toBe("mail_failed");
    expect(await getDb().select().from(invitations)).toHaveLength(1);
  });

  it("refuses an address that already signs in", async () => {
    const admin = await person("admin");
    const existing = await person();
    await expect(
      invitePerson(contextFor(admin.id), { email: existing.email.toUpperCase(), role: "user" }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  it("withdraws an invitation that has not been accepted", async () => {
    const admin = await person("admin");
    await invitePerson(contextFor(admin.id), { email: "new@example.test", role: "user" }, POSTED);
    const [row] = await getDb().select().from(invitations);
    await revokeInvitation(contextFor(admin.id), row.id);
    expect(await getDb().select().from(invitations)).toHaveLength(0);
    await expect(revokeInvitation(contextFor(admin.id), row.id)).rejects.toBeInstanceOf(AdminError);
  });
});

describe("role, block and removal", () => {
  it("changes a role", async () => {
    const admin = await person("admin");
    const other = await person();
    await setPersonRole(contextFor(admin.id), other.id, "admin");
    expect(await roleOf(other.id)).toBe("admin");
  });

  it("refuses to demote, block or remove the last admin", async () => {
    const admin = await person("admin");
    const ctx = contextFor(admin.id);
    for (const attempt of [
      () => setPersonRole(ctx, admin.id, "user"),
      () => setPersonBlocked(ctx, admin.id, true),
      () => removePerson(ctx, admin.id),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "last_admin" });
    }
    expect(await roleOf(admin.id)).toBe("admin");
  });

  it("refuses to block or remove yourself even when another admin is there", async () => {
    const admin = await person("admin");
    await person("admin");
    const ctx = contextFor(admin.id);
    await expect(setPersonBlocked(ctx, admin.id, true)).rejects.toMatchObject({ code: "self" });
    await expect(removePerson(ctx, admin.id)).rejects.toMatchObject({ code: "self" });
  });

  it("blocks a person and signs them out everywhere, then unblocks them", async () => {
    const admin = await person("admin");
    const other = await person();
    await getDb()
      .insert(sessions)
      .values({ userId: other.id, token: "live-token", expiresAt: new Date(Date.now() + 3_600_000) });

    await setPersonBlocked(contextFor(admin.id), other.id, true);
    const [blocked] = await getDb().select().from(users).where(eq(users.id, other.id));
    expect(blocked.banned).toBe(true);
    expect(await getDb().select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(0);

    await setPersonBlocked(contextFor(admin.id), other.id, false);
    const [unblocked] = await getDb().select().from(users).where(eq(users.id, other.id));
    expect(unblocked.banned).toBe(false);
    expect(unblocked.banReason).toBeNull();
  });

  it("sends the reset link only to an account that has a password", async () => {
    const admin = await person("admin");
    const ssoOnly = await person();
    await giveAccount(ssoOnly.id, "authentik");
    expect(await sendPersonReset(contextFor(admin.id), ssoOnly.id)).toBe("sso_only");
  });

  it("deletes the person, their rows and their objects in the store", async () => {
    const admin = await person("admin");
    const other = await person();
    await giveAccount(other.id, "credential");
    const key = `payslips/${other.id}/2026/${randomUUID()}.pdf`;
    await putObject(key, new TextEncoder().encode("%PDF-1.4 not really"), "application/pdf");
    expect(await getObject(key)).not.toBeNull();

    await removePerson(contextFor(admin.id), other.id);

    expect(await getDb().select().from(users).where(eq(users.id, other.id))).toHaveLength(0);
    expect(await getDb().select().from(authAccounts).where(eq(authAccounts.userId, other.id))).toHaveLength(
      0,
    );
    expect(await getObject(key)).toBeNull();
  });

  it("leaves another user's objects alone", async () => {
    const admin = await person("admin");
    const a = await person();
    const b = await person();
    const kept = `payslips/${b.id}/2026/${randomUUID()}.pdf`;
    await putObject(kept, new TextEncoder().encode("keep me"), "application/pdf");
    await removePerson(contextFor(admin.id), a.id);
    expect(await getObject(kept)).not.toBeNull();
  });
});
