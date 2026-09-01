import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { env } from "@/lib/env";

export interface AuthedUser {
  id: string;
  email: string | null;
  name: string | null;
}

export class UnauthorizedError extends Error {
  readonly status = 401;
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export function isUnauthorizedError(err: unknown): err is UnauthorizedError {
  return err instanceof UnauthorizedError;
}

export function unauthorizedResponse(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export async function getUserOrNull(): Promise<AuthedUser | null> {
  const session = await auth();
  if (!session || session.error) return null;
  const id = session.user?.id;
  // Third enforcement layer: the allowlist is re-checked here even though the
  // session callback already asserted it, because this is the only check that
  // runs inside the route/action itself (middleware is bypassable).
  if (!id || id !== env().AUTHORIZED_SUB) return null;
  return { id, email: session.user?.email ?? null, name: session.user?.name ?? null };
}

/**
 * Throws instead of redirecting so it behaves identically in route handlers and
 * in server actions (both are POST endpoints where a 3xx to an HTML sign-in page
 * is useless). Pages and other navigational contexts use
 * `requireUserOrRedirect()`.
 */
export async function requireUser(): Promise<AuthedUser> {
  const user = await getUserOrNull();
  if (!user) throw new UnauthorizedError();
  return user;
}

export async function requireUserOrRedirect(callbackUrl?: string): Promise<AuthedUser> {
  const user = await getUserOrNull();
  if (user) return user;
  const safe = callbackUrl && callbackUrl.startsWith("/") && !callbackUrl.startsWith("//") ? callbackUrl : undefined;
  redirect(safe ? `/signin?callbackUrl=${encodeURIComponent(safe)}` : "/signin");
}
