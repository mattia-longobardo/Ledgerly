// RFC 8414 metadata of Ledgerly's Authorization Server (docs/auth-design.md D3, D6). The issuer is
// `<origin>/api/auth`, so the canonical URL is `/.well-known/oauth-authorization-server/api/auth`;
// the bare `/.well-known/oauth-authorization-server` answers the same for clients that ignore
// the issuer path. Anything else under it is not an issuer of ours.
import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/platform/auth/auth";
import { AUTH_BASE_PATH } from "@/platform/auth/oauth";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/.well-known/oauth-authorization-server/[[...issuer]]">,
) {
  const { issuer } = await params;
  const path = issuer === undefined ? "" : `/${issuer.join("/")}`;
  if (path !== "" && path !== AUTH_BASE_PATH) return new Response(null, { status: 404 });
  return oauthProviderAuthServerMetadata(await getAuth())(request);
}
