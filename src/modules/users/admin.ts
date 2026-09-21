import "server-only";
import { and, asc, count, eq, gt, isNull, max, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { hasPasswordAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { createInvitation, sendInvitationEmail } from "@/platform/auth/invitations";
import { redactForLog } from "@/platform/auth/logger";
import { authAccounts, invitations, sessions, users } from "@/platform/auth/schema";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import type { Ctx, Role } from "@/platform/context";
import { getDb } from "@/platform/db/client";
import { mailAllowed } from "@/platform/settings/config";
import { deleteFolder } from "@/platform/storage";
import { personActionRefusal, type PersonAction, type PersonRefusal } from "./rules";

/**
 * Admin › Users (spec §7.10, design rows 870–877): who may sign in, how, and with what role.
 *
 * Every function re-checks `ctx.role` for itself, exactly as `platform/settings` does: the page's
 * `requireAdmin()` is the first gate, never the only one (spec §5.2). Nothing here impersonates a
 * user — deliberately not granted, see `platform/auth/permissions.ts`.
 */

export type AdminErrorCode = "forbidden" | "not_found" | "invalid" | "email_taken" | PersonRefusal;

export class AdminError extends Error {
  constructor(readonly code: AdminErrorCode) {
    super(code);
    this.name = "AdminError";
  }
}

function requireAdminCtx(ctx: Pick<Ctx, "role">): void {
  if (ctx.role !== "admin") throw new AdminError("forbidden");
}

/** How a person gets in. `invited` is a link that has gone out and not been accepted yet. */
export type SignInMethod = "password" | "sso" | "both" | "none" | "invited";

export type PersonStatus = "active" | "blocked" | "pending" | "expired";

export interface PersonRow {
  /** A row of the `users` table, or an invitation still waiting to be accepted. */
  kind: "user" | "invitation";
  id: string;
  name: string;
  email: string;
  method: SignInMethod;
  role: Role;
  lastSignInAt: Date | null;
  status: PersonStatus;
  /** True for the admin reading the page: their own row offers no block and no remove. */
  self: boolean;
}

function methodOf(hasPassword: boolean, hasSso: boolean): SignInMethod {
  if (hasPassword && hasSso) return "both";
  if (hasSso) return "sso";
  return hasPassword ? "password" : "none";
}

/**
 * Everyone who can reach this instance: the users, then the invitations still outstanding.
 *
 * "Last sign-in" is the newest session the person still has — sessions are rows (spec §5.1), and
 * the newest one's `created_at` is the last time they actually signed in. A person whose sessions
 * have all expired shows no date rather than a wrong one.
 */
export async function listPeople(ctx: Pick<Ctx, "role" | "userId">): Promise<PersonRow[]> {
  requireAdminCtx(ctx);
  const db = getDb();
  const lastSignIn = db
    .select({ userId: sessions.userId, at: max(sessions.createdAt).as("at") })
    .from(sessions)
    .groupBy(sessions.userId)
    .as("last_sign_in");
  const methods = db
    .select({
      userId: authAccounts.userId,
      hasSso: sql<boolean>`bool_or(${authAccounts.providerId} = ${OIDC_PROVIDER_ID})`.as("has_sso"),
      hasPassword: sql<boolean>`bool_or(${authAccounts.providerId} = 'credential')`.as("has_password"),
    })
    .from(authAccounts)
    .groupBy(authAccounts.userId)
    .as("methods");

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      banned: users.banned,
      lastSignInAt: lastSignIn.at,
      hasSso: methods.hasSso,
      hasPassword: methods.hasPassword,
    })
    .from(users)
    .leftJoin(lastSignIn, eq(lastSignIn.userId, users.id))
    .leftJoin(methods, eq(methods.userId, users.id))
    .orderBy(asc(users.email), asc(users.id));

  const now = new Date();
  const pending = await db
    .select({
      id: invitations.id,
      email: invitations.email,
      role: invitations.role,
      expiresAt: invitations.expiresAt,
    })
    .from(invitations)
    .where(isNull(invitations.acceptedAt))
    .orderBy(asc(invitations.email), asc(invitations.id));

  return [
    ...rows.map((row): PersonRow => ({
      kind: "user",
      id: row.id,
      name: row.name,
      email: row.email,
      method: methodOf(row.hasPassword ?? false, row.hasSso ?? false),
      role: row.role === "admin" ? "admin" : "user",
      lastSignInAt: row.lastSignInAt ?? null,
      status: row.banned ? "blocked" : "active",
      self: row.id === ctx.userId,
    })),
    ...pending.map((row): PersonRow => ({
      kind: "invitation",
      id: row.id,
      name: "",
      email: row.email,
      method: "invited",
      role: row.role,
      lastSignInAt: null,
      status: row.expiresAt > now ? "pending" : "expired",
      self: false,
    })),
  ];
}

/** How many admins are left, for {@link personActionRefusal}. Counts blocked admins too: */
/* a blocked admin can be unblocked from the container, a deleted one cannot be brought back. */
async function adminCount(): Promise<number> {
  const [row] = await getDb().select({ n: count() }).from(users).where(eq(users.role, "admin"));
  return row?.n ?? 0;
}

async function requirePerson(userId: string): Promise<{ id: string; email: string; role: Role }> {
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) throw new AdminError("invalid");
  const [row] = await getDb()
    .select({ id: users.id, email: users.email, role: users.role })
    .from(users)
    .where(eq(users.id, parsed.data));
  if (!row) throw new AdminError("not_found");
  return { ...row, role: row.role === "admin" ? "admin" : "user" };
}

async function guard(
  ctx: Pick<Ctx, "userId">,
  action: PersonAction,
  target: { id: string; role: Role },
): Promise<void> {
  const refusal = personActionRefusal(action, {
    actorId: ctx.userId,
    targetId: target.id,
    targetRole: target.role,
    adminCount: await adminCount(),
  });
  if (refusal) throw new AdminError(refusal);
}

/* Invitations (spec §5.1) — the half that was missing since F0. */

export type InviteOutcome = "sent" | "mail_off" | "mail_failed";

/**
 * Invites a person by email. The link is single-use and lasts seven days; the invitee chooses
 * Authentik or a password when they follow it.
 *
 * The answer says whether the email actually left, and a refused SMTP server is not an error here:
 * the invitation is a row and it exists either way. Throwing would leave an admin believing
 * nothing happened while a live link sits in the database — they have to know it is there, so they
 * can hand it over another way rather than wait for a message that is not coming.
 */
export async function invitePerson(
  ctx: Pick<Ctx, "role" | "userId">,
  input: { email: string; role: Role },
  deps: { sendInvitationEmail: typeof sendInvitationEmail } = { sendInvitationEmail },
): Promise<InviteOutcome> {
  requireAdminCtx(ctx);
  const parsed = z
    .object({ email: z.email().max(320), role: z.enum(["admin", "user"]) })
    .safeParse({ email: input.email.trim().toLowerCase(), role: input.role });
  if (!parsed.success) throw new AdminError("invalid");
  const [existing] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, parsed.data.email));
  if (existing) throw new AdminError("email_taken");
  // The token is minted and sent outside any transaction: `createInvitation` closes its own before
  // the email goes anywhere near an SMTP server (spec §4.3).
  const { token } = await createInvitation({ ...parsed.data, invitedBy: ctx.userId });
  try {
    return await deps.sendInvitationEmail({ email: parsed.data.email, token });
  } catch (error) {
    console.error("[users] invitation email failed", redactForLog(error));
    return "mail_failed";
  }
}

/** Withdraws an invitation that has not been accepted: the link stops working immediately. */
export async function revokeInvitation(ctx: Pick<Ctx, "role">, id: string): Promise<void> {
  requireAdminCtx(ctx);
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) throw new AdminError("invalid");
  const deleted = await getDb()
    .delete(invitations)
    .where(and(eq(invitations.id, parsed.data), isNull(invitations.acceptedAt)))
    .returning({ id: invitations.id });
  if (deleted.length === 0) throw new AdminError("not_found");
}

/* Role, block, reset, remove */

export async function setPersonRole(
  ctx: Pick<Ctx, "role" | "userId">,
  userId: string,
  role: Role,
): Promise<void> {
  requireAdminCtx(ctx);
  const target = await requirePerson(userId);
  if (target.role === role) return;
  if (role === "user") await guard(ctx, "demote", target);
  await getDb().update(users).set({ role }).where(eq(users.id, target.id));
}

/**
 * Blocks or unblocks a person. Blocking mirrors what Better Auth's admin plugin does — the `banned`
 * flag its session hook refuses a sign-in on, and every session of theirs deleted — without going
 * through an HTTP endpoint that would need this caller's own request headers.
 */
export async function setPersonBlocked(
  ctx: Pick<Ctx, "role" | "userId">,
  userId: string,
  blocked: boolean,
): Promise<void> {
  requireAdminCtx(ctx);
  const target = await requirePerson(userId);
  if (blocked) await guard(ctx, "block", target);
  await getDb()
    .update(users)
    .set(
      blocked
        ? { banned: true, banReason: "blocked_by_admin", banExpires: null }
        : { banned: false, banReason: null, banExpires: null },
    )
    .where(eq(users.id, target.id));
  // Out of the ones they already hold, too: a blocked person with a live cookie is not blocked.
  if (blocked) await getDb().delete(sessions).where(eq(sessions.userId, target.id));
}

export type ResetOutcome = "sent" | "sso_only" | "mail_off";

/**
 * Sends the person the password reset link, when there is a password to reset. An Authentik-only
 * account gets nothing: creating a password for it would be a way around Authentik's own sign-in
 * policy, which is the same reason `sendResetPassword` refuses it (spec §5.1).
 */
export async function sendPersonReset(
  ctx: Pick<Ctx, "role" | "userId">,
  userId: string,
): Promise<ResetOutcome> {
  requireAdminCtx(ctx);
  const target = await requirePerson(userId);
  if (!(await hasPasswordAccount(target.id))) return "sso_only";
  if (!(await mailAllowed("invitations"))) return "mail_off";
  await (
    await getAuth()
  ).api.requestPasswordReset({
    body: { email: target.email, redirectTo: "/reset-password" },
  });
  return "sent";
}

/**
 * Deletes a person and everything they own.
 *
 * The row goes first, in one transaction, and the foreign keys take the rest of the database with
 * it; then, outside it, the S3 folders (spec §4.3 forbids network I/O inside a transaction). The
 * order is deliberate and not the other way round: a half-deleted user who can still sign in is
 * worse than an orphaned object, and orphans are what `housekeeping` is for (plan F8 §3.4.2).
 */
export async function removePerson(ctx: Pick<Ctx, "role" | "userId">, userId: string): Promise<void> {
  requireAdminCtx(ctx);
  const target = await requirePerson(userId);
  await guard(ctx, "remove", target);
  await getDb().delete(users).where(eq(users.id, target.id));
  for (const folder of [`payslips/${target.id}/`, `cometa/${target.id}/`, `exports/${target.id}/`]) {
    try {
      await deleteFolder(folder);
    } catch (error) {
      // The user is already gone; a store that refuses to answer must not turn that into a page
      // full of stack trace. `housekeeping` sweeps what is left behind.
      console.error("[users] could not clear storage of a removed user", redactForLog(error));
    }
  }
}

/** Whether anyone else could still administer the instance, for the confirmation dialogs. */
export async function otherAdminExists(ctx: Pick<Ctx, "role" | "userId">): Promise<boolean> {
  requireAdminCtx(ctx);
  const [row] = await getDb()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.role, "admin"), ne(users.id, ctx.userId)));
  return (row?.n ?? 0) > 0;
}

/** Invitations that have not been accepted and have not run out, for the page's counters. */
export async function pendingInvitationCount(ctx: Pick<Ctx, "role">): Promise<number> {
  requireAdminCtx(ctx);
  const [row] = await getDb()
    .select({ n: count() })
    .from(invitations)
    .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  return row?.n ?? 0;
}
