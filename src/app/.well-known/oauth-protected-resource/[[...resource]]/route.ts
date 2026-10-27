// RFC 9728 protected-resource metadata: `/.well-known/oauth-protected-resource/api/v1` and
// `/api/mcp`. The 401 of each resource points here in `WWW-Authenticate`.
import { protectedResourceMetadata, RESOURCE_PATHS, type ResourceKey } from "@/platform/auth/oauth";
import { readEnv } from "@/platform/env";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: RouteContext<"/.well-known/oauth-protected-resource/[[...resource]]">,
) {
  const { resource } = await params;
  const path = `/${(resource ?? []).join("/")}`;
  const key = (Object.keys(RESOURCE_PATHS) as ResourceKey[]).find((one) => RESOURCE_PATHS[one] === path);
  if (!key) return new Response(null, { status: 404 });
  return Response.json(protectedResourceMetadata(readEnv().BETTER_AUTH_URL, key), {
    headers: { "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" },
  });
}
