import "server-only";
import { ApiClientError } from "@ledgerly/domain/platform/auth";
import { headers } from "next/headers";
import { z } from "zod";
import { readEnv } from "@ledgerly/domain/platform/env";
import { type Auth, getAuth } from "@ledgerly/domain/platform/auth";
import { issuerFor, resourceFor } from "@ledgerly/domain/platform/auth";
import { API_SCOPES, MAX_CLIENT_NAME, parseScopes } from "@ledgerly/domain/platform/auth";

/**
 * "Client API" (docs/auth-design.md D3): what replaces the personal access token. A confidential
 * OAuth client with the `client_credentials` grant, owned by the person who made it; its tokens act
 * as that person, exactly as a PAT did, and only on `/api/v1`. The secret is shown once and stored
 * hashed by the plugin, like a PAT's.
 */

const createInput = z.object({
  name: z.string().trim().min(1).max(MAX_CLIENT_NAME),
  scopes: z.array(z.enum(API_SCOPES)).min(1),
});

/** What the person needs to use the client, shown once: the secret is not kept in the clear. */
export interface MintedClient {
  clientId: string;
  clientSecret: string;
  tokenEndpoint: string;
  resource: string;
}

/**
 * Creates a Client API for the signed-in person. Goes through `auth.api` with the request's own
 * headers, so the plugin sees the session and records its user as the owner; the HTTP route of the
 * same endpoint is closed (see `SERVER_ONLY_OAUTH_PATHS` in `auth.ts`).
 */
export async function createApiClient(input: {
  name: string;
  scopes: readonly string[];
}): Promise<MintedClient> {
  return createApiClientWith(await getAuth(), await headers(), input);
}

/**
 * The same, for a given instance and the headers of a session: what `scripts/create-api-client.ts`
 * uses to make a service's client for its owner without a browser.
 */
export async function createApiClientWith(
  auth: Auth,
  sessionHeaders: Headers,
  input: { name: string; scopes: readonly string[] },
): Promise<MintedClient> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) throw new ApiClientError("invalid");
  const scopes = parseScopes(parsed.data.scopes);
  if (!scopes) throw new ApiClientError("invalid");
  const baseUrl = readEnv().BETTER_AUTH_URL;
  const created = await auth.api.adminCreateOAuthClient({
    headers: sessionHeaders,
    body: {
      client_name: parsed.data.name,
      grant_types: ["client_credentials"],
      response_types: [],
      token_endpoint_auth_method: "client_secret_basic",
      scope: scopes.join(" "),
      client_credentials_scopes: scopes,
      resources: [resourceFor(baseUrl, "api")],
      skip_consent: true,
    },
  });
  if (!created.client_secret) throw new ApiClientError("invalid");
  return {
    clientId: created.client_id,
    clientSecret: created.client_secret,
    tokenEndpoint: `${issuerFor(baseUrl)}/oauth2/token`,
    resource: resourceFor(baseUrl, "api"),
  };
}

/**
 * Deletes one of the person's own clients. Its tokens stop at once: the resource server reads the
 * client on every call (`access-token.ts`), and the tokens' rows go with it by cascade.
 */

// Read and deleted in the domain, with `/api/v1/api-clients`.
export { ApiClientError, deleteApiClient, listApiClients } from "@ledgerly/domain/platform/auth";
