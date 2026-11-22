import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { API_SCOPES, type ApiScope, consentClient } from "@ledgerly/domain/platform/auth";
import { readEnv } from "@ledgerly/domain/platform/env";
import type { ConsentView } from "@/platform/auth/remote";
import { sessionCtxOf } from "@/platform/auth/signed-in";

export const dynamic = "force-dynamic";

/**
 * The consent screen's data, for the web's server (rewrite plan R4): the signature of the query
 * and the client's row need the secret and the database, which the web has not. Only a query the
 * authorize endpoint signed gets an answer — anything else is a link someone made up, and is null.
 */
export async function GET(request: Request): Promise<Response> {
  if (!(await sessionCtxOf(request.headers))) return new Response(null, { status: 401 });
  const query = new URL(request.url).searchParams;
  const signed = query.toString();
  const clientId = query.get("client_id");
  const valid = clientId !== null && (await verifyOAuthQueryParams(signed, readEnv().BETTER_AUTH_SECRET));
  // Read from the table, not the public endpoint: the screen has to say where the code goes and
  // whether anyone vouches for the client (PERS-49 SEC-01).
  const client = valid ? await consentClient(clientId) : null;
  const requested = (query.get("scope") ?? "").split(" ").filter(Boolean);
  const body: ConsentView | null =
    client && clientId
      ? {
          clientName: client.name ?? clientId,
          scopes: API_SCOPES.filter((scope): scope is ApiScope => requested.includes(scope)),
          offline: requested.includes("offline_access"),
          hosts: client.hosts,
          verified: client.verified,
        }
      : null;
  return Response.json(body, { headers: { "Cache-Control": "private, no-store" } });
}
