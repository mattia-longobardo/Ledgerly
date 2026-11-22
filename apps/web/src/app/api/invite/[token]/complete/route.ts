import { redirect } from "next/navigation";
import { getAuth } from "@ledgerly/domain/platform/auth";
import { completeInvitationWithSso } from "@/platform/auth/invitations";

/**
 * Where a single sign-on started from an invitation returns (through `/invite/[token]/complete`
 * of the web): applies the invitation to the signed-in user, or goes back to it with the reason it
 * could not be applied. Here and not in the web, which has no database (rewrite plan R4).
 */
export async function GET(request: Request, { params }: RouteContext<"/api/invite/[token]/complete">) {
  const session = await (await getAuth()).api.getSession({ headers: request.headers });
  if (!session) redirect("/sign-in");
  const { token } = await params;
  const outcome = await completeInvitationWithSso(token, {
    userId: session.user.id,
    email: session.user.email,
  });
  if (outcome === "accepted") redirect("/");
  redirect(`/invite/${encodeURIComponent(token)}?error=${outcome}`);
}
