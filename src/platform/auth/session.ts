import "server-only";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getPreferences } from "@/modules/users/service";
import type { Preferences } from "@/modules/users/rules";
import type { Ctx } from "@/platform/context";
import { getAuth } from "./auth";

export function ctxFrom(user: { id: string; role?: string | null }, prefs: Preferences): Ctx {
  return {
    userId: user.id,
    role: user.role === "admin" ? "admin" : "user",
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    numberFormat: prefs.numberFormat,
  };
}

/** The signed-in user and their saved preferences, or null. Cached per request. */
const getSignedIn = cache(async () => {
  // Headers first: it marks the render as dynamic before Better Auth (and its env) is touched, so
  // pages Next.js tries to prerender at build time (e.g. /_not-found) never reach it.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (!session) return null;
  return { user: session.user, preferences: await getPreferences({ userId: session.user.id }) };
});

/** The signed-in user's context, or null. Cached per request. */
export const getOptionalCtx = cache(async (): Promise<Ctx | null> => {
  const signedIn = await getSignedIn();
  return signedIn && ctxFrom(signedIn.user, signedIn.preferences);
});

/** The signed-in user's saved preferences (the root layout renders their theme), or null. */
export async function getOptionalPreferences(): Promise<Preferences | null> {
  return (await getSignedIn())?.preferences ?? null;
}

/** Every page, Server Action and route handler behind sign-in starts with this. */
export async function requireSession(): Promise<Ctx> {
  const ctx = await getOptionalCtx();
  if (!ctx) redirect("/sign-in" as Route);
  return ctx;
}

/** Admin-only surfaces answer 404 to everyone else, so their existence is not disclosed. */
export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireSession();
  if (ctx.role !== "admin") notFound();
  return ctx;
}
