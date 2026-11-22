import { readEnv } from "@ledgerly/domain/platform/env";
import { acceptInvite } from "@/app/(auth)/accept-invite";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Accepts an invitation (rewrite plan R3, R4): creates the account and signs the invitee in, with the
 * answers of the Server Action it replaces — `400 {error}` with `invalid`, `email_taken`,
 * `weak_password`, `mismatch` or `name`, else `200 {next}`, where the browser goes, with the session's
 * cookie. Public: the invitee has no session yet. Only a page of this instance may call it (`Origin`),
 * so another site cannot sign a visitor into an account of its own.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/invite/[token]/accept">) {
  if (request.headers.get("origin") !== new URL(readEnv().BETTER_AUTH_URL).origin) {
    return Response.json({ error: "forbidden" }, { status: 403, headers: NO_STORE });
  }
  const { token } = await params;
  const input: unknown = await request.json().catch(() => null);
  const outcome = await acceptInvite(token, input, request.headers);
  return Response.json(outcome, { status: "error" in outcome ? 400 : 200, headers: NO_STORE });
}
