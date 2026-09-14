import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql, TransactionRollbackError } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { sendMail } from "@/platform/mail";
import type { Auth } from "./auth";
import { invitationEmail } from "./emails";
import { isPasswordLengthValid } from "./password-policy";
import { invitations, users } from "./schema";

export const INVITATION_TTL_DAYS = 7;

export class InvitationError extends Error {
  constructor(readonly reason: "invalid" | "email_taken" | "weak_password") {
    super(reason);
  }
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  input: { email: string; role: Role; invitedBy: string | null },
  now: Date = new Date(),
): Promise<{ id: string; token: string }> {
  const email = z.email().parse(input.email.trim().toLowerCase());
  const token = newToken();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const id = await getDb().transaction(async (tx) => {
    await tx.delete(invitations).where(and(eq(invitations.email, email), isNull(invitations.acceptedAt)));
    const [row] = await tx
      .insert(invitations)
      .values({ email, role: input.role, tokenHash: hashToken(token), invitedBy: input.invitedBy, expiresAt })
      .returning({ id: invitations.id });
    return row.id;
  });
  return { id, token };
}

export async function findInvitation(token: string, now: Date = new Date()) {
  const [row] = await getDb()
    .select({ id: invitations.id, email: invitations.email, role: invitations.role })
    .from(invitations)
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
      ),
    );
  return row ?? null;
}

export async function sendInvitationEmail({ email, token }: { email: string; token: string }): Promise<void> {
  await sendMail({
    to: email,
    ...invitationEmail(`${readEnv().BETTER_AUTH_URL}/invite/${token}`, INVITATION_TTL_DAYS),
  });
}

/**
 * Claims the invitation, then creates the account. The claim is released if account
 * creation fails, so the invitee can retry with the same link.
 */
export async function acceptInvitation(
  auth: Auth,
  input: { token: string; name: string; password: string },
  now: Date = new Date(),
): Promise<{ userId: string; email: string }> {
  if (!isPasswordLengthValid(input.password)) {
    throw new InvitationError("weak_password");
  }
  const db = getDb();
  const [claimed] = await db
    .update(invitations)
    .set({ acceptedAt: now })
    .where(
      and(
        eq(invitations.tokenHash, hashToken(input.token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .returning({ id: invitations.id, email: invitations.email, role: invitations.role });
  if (!claimed) throw new InvitationError("invalid");

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, claimed.email));
  if (existing) {
    await db.update(invitations).set({ acceptedAt: null }).where(eq(invitations.id, claimed.id));
    throw new InvitationError("email_taken");
  }
  try {
    const { user } = await auth.api.createUser({
      body: { email: claimed.email, password: input.password, name: input.name.trim(), role: claimed.role },
    });
    return { userId: user.id, email: claimed.email };
  } catch (error) {
    await db.update(invitations).set({ acceptedAt: null }).where(eq(invitations.id, claimed.id));
    throw error;
  }
}

export type SsoInvitationOutcome = "accepted" | "invalid" | "email_mismatch";

/**
 * The Authentik alternative to `acceptInvitation`: the invitee has just signed in through the
 * identity provider, which created (or found) their user. One transaction claims the invitation,
 * only if it is addressed to that user's email, and gives the user its role; an admin is never
 * demoted by a "user" invitation. On any other outcome nothing changes: when the user row is gone
 * or does not carry the invited address, the claim is rolled back and the answer is "email_mismatch".
 */
export async function completeInvitationWithSso(
  token: string,
  user: { userId: string; email: string },
  now: Date = new Date(),
): Promise<SsoInvitationOutcome> {
  const email = user.email.toLowerCase();
  const pending = and(
    eq(invitations.tokenHash, hashToken(token)),
    isNull(invitations.acceptedAt),
    gt(invitations.expiresAt, now),
  );
  try {
    return await getDb().transaction(async (tx) => {
      const [claimed] = await tx
        .update(invitations)
        .set({ acceptedAt: now })
        .where(and(pending, eq(sql`lower(${invitations.email})`, email)))
        .returning({ role: invitations.role });
      if (!claimed) {
        const [addressedElsewhere] = await tx.select({ id: invitations.id }).from(invitations).where(pending);
        return addressedElsewhere ? "email_mismatch" : "invalid";
      }
      const [updated] = await tx
        .update(users)
        .set({ role: sql`case when ${users.role} = 'admin' then 'admin' else ${claimed.role} end` })
        .where(and(eq(users.id, user.userId), eq(sql`lower(${users.email})`, email)))
        .returning({ id: users.id });
      if (!updated) tx.rollback();
      return "accepted";
    });
  } catch (error) {
    if (error instanceof TransactionRollbackError) return "email_mismatch";
    throw error;
  }
}
