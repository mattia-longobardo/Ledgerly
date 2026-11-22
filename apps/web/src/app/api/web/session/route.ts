import { signedInFrom } from "@/platform/auth/signed-in";
import type { RemoteSignedIn } from "@/platform/auth/remote";

export const dynamic = "force-dynamic";

/**
 * The session of the request's cookie, for the web's server (rewrite plan R4): the web has no
 * database, so its pages ask this server who is signed in. The caller's own session only, read by
 * the same rules as `/api/v1`; the session's id never leaves (`getOptionalSession`).
 */
export async function GET(request: Request): Promise<Response> {
  const signedIn = await signedInFrom(request.headers);
  const body: RemoteSignedIn | null = signedIn && {
    user: { id: signedIn.user.id, role: signedIn.user.role ?? null, email: signedIn.user.email },
    preferences: signedIn.preferences,
    setupPending: signedIn.setupPending,
  };
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
