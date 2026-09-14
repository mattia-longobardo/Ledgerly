"use server";

import { cookies } from "next/headers";
import { requireSession } from "@/platform/auth/session";
import { parseTheme, THEME_COOKIE, type ThemePreference } from "@/platform/theme";
import { getPreferences, updatePreferences } from "./service";

export async function saveTheme(theme: ThemePreference): Promise<void> {
  const ctx = await requireSession();
  const next = parseTheme(theme);
  await updatePreferences(ctx, { ...(await getPreferences(ctx)), theme: next });
  (await cookies()).set(THEME_COOKIE, next, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
}
