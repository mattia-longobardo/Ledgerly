import type { DbClient } from "@/lib/db/client";
import { db as defaultDb } from "@/lib/db";
import { redirect } from "next/navigation";
import { getUserOrNull, UnauthorizedError } from "@/lib/auth/require-user";
import { PROVIDER_ID } from "@/auth";
import { resolvePrincipal, type Principal } from "./principal";

/**
 * Split out of principal.ts because importing "@/auth" (via next-auth) pulls
 * in "next/server", which vitest's unit environment cannot resolve. This is
 * the only function in the permission catalogue that touches the session, so
 * it is the only one that needs the Next/Auth.js import graph.
 */
export async function requirePrincipal(db: DbClient = defaultDb): Promise<Principal> {
  const user = await getUserOrNull();
  if (!user) throw new UnauthorizedError();
  const principal = await resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id });
  if (!principal) throw new UnauthorizedError("No active user for this identity");
  return principal;
}

/**
 * The navigational twin of `requirePrincipal()`, mirroring the
 * `requireUser()` / `requireUserOrRedirect()` pair in `@/lib/auth/require-user`.
 *
 * A layout must not throw for an unauthenticated caller. The App Router does not
 * route a layout's own error into that segment's `error.tsx`, so a throw here
 * escapes to the bare framework error page instead of the sign-in redirect the
 * user expects. Route handlers and server actions keep the throwing variant,
 * where a 3xx to an HTML page would be useless.
 *
 * A session that is valid but has no active `users` row redirects too: from the
 * app's point of view that identity cannot act, and sign-in is the only place
 * with anything to say about it.
 */
export async function requirePrincipalOrRedirect(db: DbClient = defaultDb): Promise<Principal> {
  const user = await getUserOrNull();
  if (user) {
    const principal = await resolvePrincipal(db, { provider: PROVIDER_ID, subject: user.id });
    if (principal) return principal;
  }
  redirect("/signin");
}
