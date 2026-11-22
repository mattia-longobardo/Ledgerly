import "server-only";
import { headers } from "next/headers";
import { createApiClientWith, getAuth, type MintedClient } from "@ledgerly/domain/platform/auth";

/**
 * "Client API" (docs/auth-design.md D3): what replaces the personal access token. A confidential
 * OAuth client with the `client_credentials` grant, owned by the person who made it; its tokens act
 * as that person, exactly as a PAT did, and only on `/api/v1`. The secret is shown once and stored
 * hashed by the plugin, like a PAT's.
 */

/** Creates a Client API for the signed-in person of this request (`createApiClientWith`). */
export async function createApiClient(input: {
  name: string;
  scopes: readonly string[];
}): Promise<MintedClient> {
  return createApiClientWith(await getAuth(), await headers(), input);
}

// Made, read and deleted in the domain, with `/api/v1/api-clients`.
export {
  ApiClientError,
  createApiClientWith,
  deleteApiClient,
  listApiClients,
  type MintedClient,
} from "@ledgerly/domain/platform/auth";
