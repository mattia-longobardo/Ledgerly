import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { readEnv } from "@/platform/env";
import { sendMail } from "@/platform/mail";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, type Auth } from "./auth";
import { invitationEmail } from "./emails";
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
  if (input.password.length < MIN_PASSWORD_LENGTH || input.password.length > MAX_PASSWORD_LENGTH) {
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
