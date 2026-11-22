import { redirect } from "next/navigation";

/**
 * Where a single sign-on started from an invitation returns: the server's process applies it
 * (`/api/invite/[token]/complete`), because the web has no database (rewrite plan R4).
 */
export async function GET(_request: Request, { params }: RouteContext<"/invite/[token]/complete">) {
  const { token } = await params;
  redirect(`/api/invite/${encodeURIComponent(token)}/complete`);
}
