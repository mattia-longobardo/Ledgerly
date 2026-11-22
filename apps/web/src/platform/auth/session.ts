import "server-only";
import type { Route } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { TWO_FACTOR_SETUP_PATH } from "@ledgerly/domain/platform/auth/client";
import { buildCtx, type Preferences } from "./signed-in";
import { fetchSignedIn } from "./remote";

/** The session's context: the one mapping of the domain (audit USR-3). */
export { buildCtx as ctxFrom };

/**
 * The signed-in user of this render, cached per request: the server's process reads it
 * (`/api/web/session`), because the web has no database of its own (rewrite plan R4).
 */
const getSignedIn = cache(async () =>
  // Headers first: it marks the render as dynamic before the server is asked, so pages Next.js
  // tries to prerender at build time (e.g. /_not-found) never reach it.
  fetchSignedIn(await headers()),
);

/**
 * The signed-in user's context, or null. Cached per request. A session still waiting for its TOTP
 * setup has no context: every page, action and route that needs one treats it as signed out.
 */
export const getOptionalCtx = cache(async (): Promise<Ctx | null> => {
  const signedIn = await getSignedIn();
  return signedIn && !signedIn.setupPending ? buildCtx(signedIn.user, signedIn.preferences) : null;
});

/**
 * The signed-in user's context with the id of the session they hold, or null. For the one flow
 * that leaves the app and comes back (an access to a bank): what comes back must have left from
 * this very session, so the id is what the flow is tied to. The id never goes to a browser.
 *
 * shortcut: reads the database itself; its last caller (`banks/connect/actions.ts`) moves to
 * `/api/v1` before the web runs without a database (R3-coda), and this goes with it.
 */
export async function getOptionalSession(): Promise<{ ctx: Ctx; sessionId: string } | null> {
  const ctx = await getOptionalCtx();
  if (!ctx) return null;
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  return session ? { ctx, sessionId: session.session.id } : null;
}

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

/** The signed-in user's saved preferences, behind the same gate as `requireSession`. */
export async function requirePreferences(): Promise<Preferences> {
  await requireSession();
  return (await getSignedIn())?.preferences ?? redirect("/sign-in" as Route);
}
