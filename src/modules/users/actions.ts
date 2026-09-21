// src/modules/users/actions.ts — the users module's Server Actions (spec §3): validate → service → revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { hasSsoAccount } from "@/platform/auth/accounts";
import { getAuth } from "@/platform/auth/auth";
import { redactForLog } from "@/platform/auth/logger";
import { nameSchema } from "@/platform/auth/name-policy";
import { requireAdmin, requireSession } from "@/platform/auth/session";
import type { Role } from "@/platform/context";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import {
  AdminError,
  type AdminErrorCode,
  invitePerson,
  type InviteOutcome,
  removePerson,
  type ResetOutcome,
  revokeInvitation,
  sendPersonReset,
  setPersonBlocked,
  setPersonRole,
} from "./admin";
import type { Preferences } from "./rules";
import { findSessionToken, getPreferences, updatePreferences } from "./service";

const YEAR = 60 * 60 * 24 * 365;

/**
 * Every settings Server Action reports failure this way instead of throwing: a form calls it
 * inside a transition with no error boundary, so a Zod or provider error must not crash the page.
 * `error` is a catalogued message key under the calling component's own `next-intl` namespace.
 */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** The saved preference is what every page renders with; the cookie only serves anonymous pages. */
export async function saveTheme(theme: ThemePreference): Promise<void> {
  const ctx = await requireSession();
  const next = parseTheme(theme);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), theme: next });
  (await cookies()).set(THEME_COOKIE, next, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function savePreferencesAction(input: Preferences): Promise<ActionResult> {
  const ctx = await requireSession();
  try {
    const saved = await updatePreferences(ctx, input);
    const jar = await cookies();
    jar.set(LOCALE_COOKIE, saved.locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
    jar.set(THEME_COOKIE, saved.theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { ok: false, error: "invalid" };
    throw error;
  }
}

/** With Authentik linked, name and email are managed by the provider (spec §5.1): refused here, not only in the UI. */
export async function updateNameAction(name: string): Promise<ActionResult> {
  const ctx = await requireSession();
  if (await hasSsoAccount(ctx.userId)) return { ok: false, error: "sso" };
  const parsed = nameSchema.safeParse(name);
  if (!parsed.success) return { ok: false, error: "invalid" };
  await (await getAuth()).api.updateUser({ body: { name: parsed.data }, headers: await headers() });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Takes a session id from the browser; the token is looked up server-side, by id AND the caller's user id. */
export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  const ctx = await requireSession();
  const parsed = z.uuid().safeParse(sessionId);
  if (!parsed.success) return { ok: false, error: "failed" };
  try {
    const token = await findSessionToken(ctx, parsed.data);
    if (!token) return { ok: true };
    await (await getAuth()).api.revokeSession({ body: { token }, headers: await headers() });
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return revocationFailed(error);
  }
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  await requireSession();
  try {
    await (await getAuth()).api.revokeOtherSessions({ headers: await headers() });
    revalidatePath("/settings/security");
    return { ok: true };
  } catch (error) {
    return revocationFailed(error);
  }
}

function revocationFailed(error: unknown): ActionResult {
  console.error("[users] session revocation failed", redactForLog(error));
  return { ok: false, error: "failed" };
}

/* Admin › Users (spec §7.10) — plan F8 P1. Admins only; every service re-checks that for itself. */

/**
 * What an admin action answers. `error` is a message key under the page's own `next-intl`
 * namespace; `outcome` is the service's own answer for the actions that have more than one way
 * of succeeding (an invitation whose email the SMTP switches held back, for instance).
 */
export type AdminActionResult<T = never> = { ok: true; outcome: T } | { ok: false; error: AdminErrorCode };

/** The answer of an action that either works or explains why not. */
const DONE = { ok: true, outcome: undefined } as AdminActionResult<undefined>;

function adminFailure(error: unknown): { ok: false; error: AdminErrorCode } {
  if (error instanceof AdminError) return { ok: false, error: error.code };
  throw error;
}

export async function invitePersonAction(
  email: string,
  role: Role,
): Promise<AdminActionResult<InviteOutcome>> {
  const ctx = await requireAdmin();
  try {
    const outcome = await invitePerson(ctx, { email, role });
    revalidatePath("/settings/users");
    return { ok: true, outcome };
  } catch (error) {
    return adminFailure(error);
  }
}

export async function revokeInvitationAction(id: string): Promise<AdminActionResult<undefined>> {
  const ctx = await requireAdmin();
  try {
    await revokeInvitation(ctx, id);
    revalidatePath("/settings/users");
    return DONE;
  } catch (error) {
    return adminFailure(error);
  }
}

export async function setPersonRoleAction(userId: string, role: Role): Promise<AdminActionResult<undefined>> {
  const ctx = await requireAdmin();
  try {
    await setPersonRole(ctx, userId, role);
    revalidatePath("/settings/users");
    return DONE;
  } catch (error) {
    return adminFailure(error);
  }
}

export async function setPersonBlockedAction(
  userId: string,
  blocked: boolean,
): Promise<AdminActionResult<undefined>> {
  const ctx = await requireAdmin();
  try {
    await setPersonBlocked(ctx, userId, blocked);
    revalidatePath("/settings/users");
    return DONE;
  } catch (error) {
    return adminFailure(error);
  }
}

export async function sendPersonResetAction(userId: string): Promise<AdminActionResult<ResetOutcome>> {
  const ctx = await requireAdmin();
  try {
    return { ok: true, outcome: await sendPersonReset(ctx, userId) };
  } catch (error) {
    return adminFailure(error);
  }
}

/** Deletes the person and everything they own: the confirmation is the dialog's job, not this. */
export async function removePersonAction(userId: string): Promise<AdminActionResult<undefined>> {
  const ctx = await requireAdmin();
  try {
    await removePerson(ctx, userId);
    revalidatePath("/settings/users");
    return DONE;
  } catch (error) {
    return adminFailure(error);
  }
}
