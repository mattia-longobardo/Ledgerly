// The person's Client APIs (docs/auth-design.md D3): the rows of `oauth_clients` they own with the
// `client_credentials` grant. Read and deleted here, by the Settings page and by `/api/v1/api-clients`;
// made by Better Auth inside the person's session (the web's `api-clients.ts`).
import { and, arrayContains, desc, eq } from "drizzle-orm";
import { z } from "zod";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { userScoped } from "../db/scope";
import type { ApiScope } from "./oauth";
import { oauthClients } from "./oauth/schema";
import { API_SCOPES } from "./scopes";

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
