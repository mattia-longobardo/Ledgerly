// tests/e2e/mcp.spec.ts — the MCP server (docs/auth-design.md D6) end to end, with the MCP SDK's own
// client doing what Claude or MCP Inspector does: the 401, RFC 9728 and RFC 8414 discovery, dynamic
// registration of a public client, PKCE. The browser half — consent — is the real page, as the
// seeded `layout` user, whose accounts the tools then read. The client it registers has no owner,
// so the seed's remove deletes it by name (E2E_MCP_CLIENT_NAME).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { expect, request as http, test } from "@playwright/test";
import { BASE_URL, E2E_MCP_CLIENT_NAME, sessionState } from "./env";

test.use({ storageState: sessionState("layout") });

const MCP_URL = new URL("/api/mcp", BASE_URL);
// A loopback redirect, as a desktop client registers; nothing listens there, the page intercepts it.
const REDIRECT = "http://127.0.0.1:33418/callback";

/** An in-memory client, like the one a desktop MCP client keeps on disk. */
class MemoryProvider implements OAuthClientProvider {
  info?: OAuthClientInformationMixed;
  saved?: OAuthTokens;
  verifier = "";
  authorizationUrl?: URL;

  get redirectUrl() {
    return REDIRECT;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: E2E_MCP_CLIENT_NAME,
      redirect_uris: [REDIRECT],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: "read",
    };
  }
  clientInformation() {
    return this.info;
  }
  saveClientInformation(info: OAuthClientInformationMixed) {
    this.info = info;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  redirectToAuthorization(url: URL) {
    this.authorizationUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }
}

test("an MCP client discovers, registers, gets consent and reads only through /api/mcp", async ({ page }) => {
  const provider = new MemoryProvider();
  const transport = () => new StreamableHTTPClientTransport(MCP_URL, { authProvider: provider });

  // 1. No token: the SDK follows the 401's resource_metadata, registers itself, and asks for the browser.
  const first = transport();
  await expect(new Client({ name: "e2e", version: "1" }).connect(first)).rejects.toBeInstanceOf(
    UnauthorizedError,
  );
  expect(provider.info?.client_id).toBeTruthy();
  const authorize = provider.authorizationUrl!;
  expect(authorize.origin + authorize.pathname).toBe(`${BASE_URL}/api/auth/oauth2/authorize`);
  expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
  expect(authorize.searchParams.get("resource")).toBe(MCP_URL.href);
  // The SDK asks for what the metadata offers: `read` and `investments:read` (investments.md §5.5).
  expect(authorize.searchParams.get("scope")?.split(" ")).toEqual(
    expect.arrayContaining(["read", "investments:read"]),
  );

  // 2. The person: signed in already, so straight to consent; "Allow" sends the code to the client.
  let code: string | null = null;
  await page.route(`${REDIRECT}**`, async (route) => {
    code = new URL(route.request().url()).searchParams.get("code");
    await route.fulfill({ status: 200, body: "ok" });
  });
  await page.goto(authorize.href);
  await expect(page).toHaveURL(/\/oauth\/consent/);
  await expect(page.getByText(E2E_MCP_CLIENT_NAME)).toBeVisible();
  // PERS-49 SEC-01: where the code goes, and that nobody vouches for the name.
  await expect(page.getByText("127.0.0.1:33418")).toBeVisible();
  await expect(page.getByText("Unverified client.")).toBeVisible();
  // investments:read is never implied: the consent page names it.
  await expect(page.getByText("investments:read", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Allow" }).click();
  await expect.poll(() => code).not.toBeNull();

  // 3. The code, the PKCE verifier, the token: the client is connected.
  await first.finishAuth(code!);
  expect(provider.saved?.access_token).toBeTruthy();
  const client = new Client({ name: "e2e", version: "1" });
  await client.connect(transport());
  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "get_account_balances",
    "get_investment_holdings",
    "get_summary",
    "list_accounts",
    "list_budgets",
    "list_investments",
    "list_transactions",
  ]);
  const listed = await client.callTool({ name: "list_accounts", arguments: {} });
  const { accounts } = JSON.parse((listed.content as { text: string }[])[0].text) as {
    accounts: { id: string; balance: string | null }[];
  };
  expect(accounts.length).toBeGreaterThan(0);
  const summary = await client.callTool({ name: "get_summary", arguments: {} });
  expect(JSON.parse((summary.content as { text: string }[])[0].text)).toHaveProperty("netWorth");
  await client.close();

  // 4. The token's audience is /api/mcp: /api/v1 does not take it.
  const script = await http.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const api = await script.get("/api/v1/accounts", {
    headers: { authorization: `Bearer ${provider.saved!.access_token}` },
  });
  expect(api.status()).toBe(401);

  // 5. Connected apps (PERS-49 SEC-05): the consent is listed, and "Revoke" ends the refresh token.
  await page.goto("/settings/security");
  const apps = page.getByRole("region", { name: "Connected apps" });
  await expect(apps.getByText(E2E_MCP_CLIENT_NAME).first()).toBeVisible();
  await apps.getByRole("button", { name: "Revoke" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText(`Access for ${E2E_MCP_CLIENT_NAME} revoked`)).toBeVisible();
  const refreshed = await script.post("/api/auth/oauth2/token", {
    form: {
      grant_type: "refresh_token",
      refresh_token: provider.saved!.refresh_token ?? "none",
      client_id: provider.info!.client_id,
    },
  });
  expect(refreshed.status()).toBeGreaterThanOrEqual(400);
  await script.dispose();
});

test("a self-registration with a redirect outside the allowlist is refused (PERS-49 SEC-01)", async () => {
  const script = await http.newContext({ baseURL: BASE_URL, storageState: { cookies: [], origins: [] } });
  const response = await script.post("/api/auth/oauth2/register", {
    data: {
      client_name: E2E_MCP_CLIENT_NAME,
      redirect_uris: ["https://evil.example/cb"],
      token_endpoint_auth_method: "none",
    },
  });
  expect(response.status()).toBe(400);
  expect(await response.json()).toMatchObject({ error: "invalid_redirect_uri" });
  await script.dispose();
});
