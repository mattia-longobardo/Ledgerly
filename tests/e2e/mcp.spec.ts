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

  // 2. The person: signed in already, so straight to consent; "Allow" sends the code to the client.
  let code: string | null = null;
  await page.route(`${REDIRECT}**`, async (route) => {
    code = new URL(route.request().url()).searchParams.get("code");
    await route.fulfill({ status: 200, body: "ok" });
  });
  await page.goto(authorize.href);
  await expect(page).toHaveURL(/\/oauth\/consent/);
  await expect(page.getByText(E2E_MCP_CLIENT_NAME)).toBeVisible();
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
    "get_summary",
    "list_accounts",
    "list_budgets",
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
  await script.dispose();
});
