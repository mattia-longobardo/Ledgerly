// OpenID Connect discovery at the root, for MCP clients that look here instead of RFC 8414
// (docs/auth-design.md D6). Same issuer, same document Better Auth builds.
import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/platform/auth/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return oauthProviderOpenIdConfigMetadata(await getAuth())(request);
}
