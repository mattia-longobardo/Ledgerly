// src/modules/users/actions.ts — the users module's Server Actions (spec §3): validate → service → revalidate.
"use server";

import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { z } from "zod";
import { getAuth } from "@/platform/auth/auth";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";
import { requireSession } from "@/platform/auth/session";
import { LOCALE_COOKIE } from "@/platform/i18n/locales";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import type { Preferences } from "./rules";
import { findSessionToken, getPreferences, updatePreferences } from "./service";

const YEAR = 60 * 60 * 24 * 365;

export async function saveTheme(theme: ThemePreference): Promise<void> {
  const ctx = await requireSession();
  const next = parseTheme(theme);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), theme: next });
  (await cookies()).set(THEME_COOKIE, next, { path: "/", maxAge: YEAR, sameSite: "lax" });
}

export async function savePreferencesAction(input: Preferences): Promise<void> {
  const ctx = await requireSession();
  const saved = await updatePreferences(ctx, input);
  const jar = await cookies();
  jar.set(LOCALE_COOKIE, saved.locale, { path: "/", maxAge: YEAR, sameSite: "lax" });
  jar.set(THEME_COOKIE, saved.theme, { path: "/", maxAge: YEAR, sameSite: "lax" });
  revalidatePath("/", "layout");
}

/** With Authentik linked, name and email are managed by the provider (spec §5.1): refused here, not only in the UI. */
export async function updateNameAction(name: string): Promise<void> {
  await requireSession();
  const requestHeaders = await headers();
  const accounts = await getAuth().api.listUserAccounts({ headers: requestHeaders });
  if (accounts.some((account) => account.providerId === OIDC_PROVIDER_ID)) {
    throw new Error("The name is managed by Authentik while SSO is linked");
  }
  const parsed = z.string().trim().min(1).max(120).parse(name);
  await getAuth().api.updateUser({ body: { name: parsed }, headers: requestHeaders });
  revalidatePath("/", "layout");
}

/** Takes a session id from the browser; the token is looked up server-side, by id AND the caller's user id. */
export async function revokeSessionAction(sessionId: string): Promise<void> {
  const ctx = await requireSession();
  const token = await findSessionToken(ctx, z.uuid().parse(sessionId));
  if (!token) return;
  await getAuth().api.revokeSession({ body: { token }, headers: await headers() });
  revalidatePath("/settings/security");
}

export async function revokeOtherSessionsAction(): Promise<void> {
  await requireSession();
  await getAuth().api.revokeOtherSessions({ headers: await headers() });
  revalidatePath("/settings/security");
}
