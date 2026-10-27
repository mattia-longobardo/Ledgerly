import "server-only";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { getPreferences } from "@/modules/users/service";
import type { Preferences } from "@/modules/users/rules";
import type { Ctx } from "@/platform/context";
import { readEnv } from "@/platform/env";
import { numberStyle } from "@/platform/format";
import { hasPasswordAccount } from "./accounts";
import { getAuth } from "./auth";
import { TWO_FACTOR_SETUP_PATH, twoFactorSetupRequired } from "./two-factor-policy";

export function ctxFrom(user: { id: string; role?: string | null }, prefs: Preferences): Ctx {
  return {
    userId: user.id,
    role: user.role === "admin" ? "admin" : "user",
    locale: prefs.locale,
    timeZone: prefs.timeZone,
    numberFormat: numberStyle(prefs),
    displayCurrency: prefs.displayCurrency,
  };
}

/**
 * The signed-in user and their saved preferences, or null. Cached per request. `setupPending`: the
 * session is real but the person still has to set up TOTP (TWO_FACTOR_POLICY=required), so it opens
 * only the setup page and nothing else.
 */
const getSignedIn = cache(async () => {
  // Headers first: it marks the render as dynamic before Better Auth (and its env) is touched, so
  // pages Next.js tries to prerender at build time (e.g. /_not-found) never reach it.
  const requestHeaders = await headers();
  const session = await (await getAuth()).api.getSession({ headers: requestHeaders });
  if (!session) return null;
  const policy = readEnv().TWO_FACTOR_POLICY;
  const twoFactorEnabled = session.user.twoFactorEnabled === true;
  // The account lookup only when it can change the answer: most requests skip it.
  const setupPending =
    policy === "required" &&
    !twoFactorEnabled &&
    twoFactorSetupRequired({
      policy,
      twoFactorEnabled,
      hasPassword: await hasPasswordAccount(session.user.id),
    });
  return {
    user: session.user,
    preferences: await getPreferences({ userId: session.user.id }),
    setupPending,
  };
});

/**
 * The signed-in user's context, or null. Cached per request. A session still waiting for its TOTP
 * setup has no context: every page, action and route that needs one treats it as signed out.
 */
export const getOptionalCtx = cache(async (): Promise<Ctx | null> => {
  const signedIn = await getSignedIn();
  return signedIn && !signedIn.setupPending ? ctxFrom(signedIn.user, signedIn.preferences) : null;
});

/** The person on the TOTP setup page: signed in, with the setup still to do. */
export async function requireTwoFactorSetup(): Promise<{ email: string; preferences: Preferences }> {
  const signedIn = await getSignedIn();
  if (!signedIn) redirect("/sign-in" as Route);
  if (!signedIn.setupPending) redirect("/" as Route);
  return { email: signedIn.user.email, preferences: signedIn.preferences };
}

/** Where `/sign-in` sends a person who already has a session: the app, or the TOTP setup first. */
export async function signedInDestination(): Promise<Route | null> {
  const signedIn = await getSignedIn();
  if (!signedIn) return null;
  return (signedIn.setupPending ? TWO_FACTOR_SETUP_PATH : "/") as Route;
}

/** The signed-in user's saved preferences (the root layout renders their theme), or null. */
export async function getOptionalPreferences(): Promise<Preferences | null> {
  return (await getSignedIn())?.preferences ?? null;
}

/** Every page, Server Action and route handler behind sign-in starts with this. */
export async function requireSession(): Promise<Ctx> {
  const ctx = await getOptionalCtx();
  if (ctx) return ctx;
  redirect(((await getSignedIn())?.setupPending ? TWO_FACTOR_SETUP_PATH : "/sign-in") as Route);
}

/** Admin-only surfaces answer 404 to everyone else, so their existence is not disclosed. */
export async function requireAdmin(): Promise<Ctx> {
  const ctx = await requireSession();
  if (ctx.role !== "admin") notFound();
  return ctx;
}
