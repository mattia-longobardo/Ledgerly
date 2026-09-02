import type { DbClient } from "@/lib/db/client";
import { db as defaultDb } from "@/lib/db";
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
