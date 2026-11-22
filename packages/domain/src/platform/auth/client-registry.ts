// The person's Client APIs (docs/auth-design.md D3): the rows of `oauth_clients` they own with the
// `client_credentials` grant. Read and deleted here, by the Settings page and by `/api/v1/api-clients`;
// made by Better Auth inside the person's session, by Settings and by `POST /api/v1/api-clients`.
import { and, arrayContains, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../context";
import { readEnv } from "../env";
import { getDb } from "../db/client";
import { userScoped } from "../db/scope";
import type { ApiScope } from "./oauth";
import { oauthClients } from "./oauth/schema";
import type { Auth } from "./auth";
import { issuerFor, resourceFor } from "./oauth";
import { API_SCOPES, MAX_CLIENT_NAME, parseScopes } from "./scopes";

export class ApiClientError extends Error {
  constructor(readonly code: "invalid" | "not_found") {
    super(code);
    this.name = "ApiClientError";
  }
}

interface ApiClientView {
  clientId: string;
  name: string;
  scopes: ApiScope[];
  createdAt: Date;
  disabled: boolean;
}

/** The person's own Client API rows: confidential `client_credentials` clients they own. */
export async function listApiClients(ctx: Pick<Ctx, "userId">): Promise<ApiClientView[]> {
  const rows = await getDb()
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      scopes: oauthClients.clientCredentialsScopes,
      createdAt: oauthClients.createdAt,
      disabled: oauthClients.disabled,
    })
    .from(oauthClients)
    .where(
      and(userScoped(ctx).owns(oauthClients), arrayContains(oauthClients.grantTypes, ["client_credentials"])),
    )
    .orderBy(desc(oauthClients.createdAt), desc(oauthClients.id));
  return rows.map((row) => ({
    clientId: row.clientId,
    name: row.name ?? row.clientId,
    scopes: API_SCOPES.filter((scope) => row.scopes?.includes(scope)),
    createdAt: row.createdAt,
    disabled: row.disabled === true,
  }));
}

export async function deleteApiClient(ctx: Pick<Ctx, "userId">, clientId: string): Promise<void> {
  const parsed = z.string().min(1).max(200).safeParse(clientId);
  if (!parsed.success) throw new ApiClientError("invalid");
  const deleted = await getDb()
    .delete(oauthClients)
    .where(and(eq(oauthClients.clientId, parsed.data), userScoped(ctx).owns(oauthClients)))
    .returning({ id: oauthClients.id });
  if (deleted.length === 0) throw new ApiClientError("not_found");
}

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
 * Creates a Client API for the person of a session: Better Auth reads the session in `sessionHeaders` and
 * records its user as the owner (the HTTP route of the same endpoint is closed, `SERVER_ONLY_OAUTH_PATHS`).
 * The Settings page, `POST /api/v1/api-clients` and `scripts/create-api-client.ts` make one this way.
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
