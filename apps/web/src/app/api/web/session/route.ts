import { remoteSignedIn, signedInFrom } from "@/platform/auth/signed-in";

export const dynamic = "force-dynamic";

/**
 * The session of the request's cookie, for the web's server (rewrite plan R4): the web has no
 * database, so its pages ask this server who is signed in. The caller's own session only, read by
 * the same rules as `/api/v1`; the session's id never leaves (`getOptionalSession`).
 */
export async function GET(request: Request): Promise<Response> {
  const body = remoteSignedIn(await signedInFrom(request.headers));
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
