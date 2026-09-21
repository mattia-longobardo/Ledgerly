import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/platform/auth/auth";
import { completeInvitationWithSso } from "@/platform/auth/invitations";

/**
 * Where an Authentik sign-in started from an invitation returns: applies the invitation to the
 * signed-in user, or goes back to it with the reason it could not be applied.
 */
export async function GET(_request: Request, { params }: RouteContext<"/invite/[token]/complete">) {
  const session = await (await getAuth()).api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");
  const { token } = await params;
  const outcome = await completeInvitationWithSso(token, {
    userId: session.user.id,
    email: session.user.email,
  });
  if (outcome === "accepted") redirect("/");
  redirect(`/invite/${encodeURIComponent(token)}?error=${outcome}`);
}
