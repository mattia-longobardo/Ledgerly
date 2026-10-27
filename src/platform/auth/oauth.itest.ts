import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/platform/db/client";
import { closeDatabase, resetDatabase } from "../../../test/db";
import { oauthClientResources } from "./oauth/schema";
import { authAccounts } from "./schema";

// Ledgerly as Authorization Server for /api/v1 (docs/auth-design.md D3, D4), against the real
// plugin and database: a Client API, its client_credentials token, the audience and scope checks,
// deletion taking effect at once, the PAT transition, and the doors that stay closed.

let requestHeaders = new Headers();
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/server", () => ({ after: () => {} }));

const { getAuth, invalidateAuth } = await import("./auth");
const { createApiClient, deleteApiClient, listApiClients, ApiClientError } = await import("./api-clients");
const { api } = await import("@/platform/api/app");
const { resetRateLimits } = await import("@/platform/api/rate-limit");
const { createToken } = await import("@/platform/tokens/service");

const ORIGIN = "http://127.0.0.1:3000";
const API = `${ORIGIN}/api/v1`;
const MCP = `${ORIGIN}/api/mcp`;
const PASSWORD = "correct-horse-battery";

function cookiesFrom(headers: Headers): Headers {
  const jar = headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((pair) => !pair.endsWith("="));
  return new Headers({ cookie: jar.join("; ") });
}

/** A signed-in person whose only door is SSO (the password row removed), so no TOTP is owed. */
async function ssoPerson(email = "oauth@example.test"): Promise<{ userId: string; headers: Headers }> {
  const auth = await getAuth();
  const created = await auth.api.createUser({ body: { email, password: PASSWORD, name: "OAuth" } });
  const { headers } = await auth.api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  await getDb()
    .delete(authAccounts)
    .where(and(eq(authAccounts.userId, created.user.id), eq(authAccounts.providerId, "credential")));
  return { userId: created.user.id, headers: cookiesFrom(headers) };
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return (await getAuth()).handler(new Request(`${ORIGIN}/api/auth${path}`, init));
}

async function clientToken(
  clientId: string,
  clientSecret: string,
  extra: Record<string, string> = { resource: API },
): Promise<Response> {
  return authFetch("/oauth2/token", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials", ...extra }).toString(),
  });
}

async function accessToken(clientId: string, clientSecret: string, extra?: Record<string, string>) {
  const response = await clientToken(clientId, clientSecret, extra);
  expect(response.status).toBe(200);
  return ((await response.json()) as { access_token: string }).access_token;
}

async function callApi(path: string, token: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);
  return api.fetch(new Request(`${API}${path}`, { ...init, headers }));
}

beforeEach(async () => {
  await resetDatabase();
  invalidateAuth();
  resetRateLimits();
  requestHeaders = new Headers();
});

afterAll(closeDatabase);

describe("Client API (client_credentials)", () => {
  it("mints a client whose token reads /api/v1 as its owner", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const minted = await createApiClient({ name: "Home Assistant", scopes: ["read"] });
    expect(minted.resource).toBe(API);
    expect(minted.tokenEndpoint).toBe(`${ORIGIN}/api/auth/oauth2/token`);

    const listed = await listApiClients({ userId: person.userId });
    expect(listed).toEqual([
      expect.objectContaining({ clientId: minted.clientId, name: "Home Assistant", scopes: ["read"] }),
    ]);

    const token = await accessToken(minted.clientId, minted.clientSecret);
    const response = await callApi("/accounts", token);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-ratelimit-limit")).not.toBeNull();
  });

  it("answers 401 with a WWW-Authenticate challenge without a token, or with a bad one", async () => {
    const missing = await callApi("/accounts", null);
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ORIGIN}/.well-known/oauth-protected-resource/api/v1"`,
    );
    const forged = await callApi("/accounts", "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ4In0.c2ln");
    expect(forged.status).toBe(401);
    expect(forged.headers.get("www-authenticate")).toMatch(
      /^Bearer error="invalid_token", resource_metadata=/,
    );
  });

  it("answers 403 insufficient_scope when the token lacks the route's scope", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const minted = await createApiClient({ name: "reader", scopes: ["read"] });
    const token = await accessToken(minted.clientId, minted.clientSecret);
    const response = await callApi("/imports", token, { method: "POST", body: new FormData() });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(response.headers.get("www-authenticate")).toMatch(/error="insufficient_scope".*scope="imports"/);
  });

  it("refuses a token minted for another resource, and one without an audience", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const minted = await createApiClient({ name: "script", scopes: ["read"] });
    // A token for the MCP resource carries that audience, and /api/v1 does not take it.
    const forMcp = await accessToken(minted.clientId, minted.clientSecret, { resource: MCP });
    expect((await callApi("/accounts", forMcp)).status).toBe(401);
    // No resource: an opaque token, which /api/v1 does not take.
    const opaque = await accessToken(minted.clientId, minted.clientSecret, {});
    expect((await callApi("/accounts", opaque)).status).toBe(401);
  });

  it("stops a deleted client's tokens at once", async () => {
    const person = await ssoPerson();
    requestHeaders = person.headers;
    const minted = await createApiClient({ name: "gone", scopes: ["read"] });
    const token = await accessToken(minted.clientId, minted.clientSecret);
    expect((await callApi("/accounts", token)).status).toBe(200);
    await deleteApiClient({ userId: person.userId }, minted.clientId);
    expect((await callApi("/accounts", token)).status).toBe(401);
    await expect(deleteApiClient({ userId: person.userId }, minted.clientId)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });

  it("does not let one person delete another person's client", async () => {
    const owner = await ssoPerson("owner@example.test");
    requestHeaders = owner.headers;
    const minted = await createApiClient({ name: "mine", scopes: ["read"] });
    const other = await ssoPerson("other@example.test");
    await expect(deleteApiClient({ userId: other.userId }, minted.clientId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("refuses a person who still owes the TOTP setup", async () => {
    const auth = await getAuth();
    await auth.api.createUser({
      body: { email: "pending@example.test", password: PASSWORD, name: "Pending" },
    });
    const { headers } = await auth.api.signInEmail({
      body: { email: "pending@example.test", password: PASSWORD },
      returnHeaders: true,
    });
    requestHeaders = cookiesFrom(headers);
    await expect(createApiClient({ name: "nope", scopes: ["read"] })).rejects.toThrow();
  });
});

describe("the doors that stay closed", () => {
  it("serves the client endpoints only through auth.api, never over HTTP", async () => {
    const person = await ssoPerson();
    const response = await authFetch("/oauth2/create-client", {
      method: "POST",
      headers: { ...Object.fromEntries(person.headers), "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ redirect_uris: ["https://example.test/cb"] }),
    });
    expect(response.status).toBe(403);
  });

  it("lets anyone register a public client, and nobody a confidential one", async () => {
    const register = (body: Record<string, unknown>) =>
      authFetch("/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], ...body }),
      });
    expect((await register({ token_endpoint_auth_method: "client_secret_basic" })).status).toBe(400);
    const response = await register({ token_endpoint_auth_method: "none", client_name: "MCP client" });
    expect(response.status, await response.clone().text()).toBe(201);
    const client = (await response.json()) as { client_id: string; client_secret?: string };
    expect(client.client_secret).toBeUndefined();
  });

  it("registers a desktop client with a loopback http redirect as a native one (RFC 8252)", async () => {
    const response = await authFetch("/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "MCP Inspector",
        redirect_uris: ["http://localhost:6274/oauth/callback"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toMatchObject({ application_type: "native" });
    // Plain http elsewhere is still refused.
    const remote = await authFetch("/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["http://example.com/cb"], token_endpoint_auth_method: "none" }),
    });
    expect(remote.status).toBe(400);
  });

  it("refuses a self-registration whose redirect is neither loopback nor allowlisted (SEC-01)", async () => {
    const response = await authFetch("/oauth2/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Claude",
        redirect_uris: ["https://evil.example/cb"],
        token_endpoint_auth_method: "none",
      }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_redirect_uri" });
  });

  it("never links a self-registered client to /api/v1, nor gives it more than read (SEC-01)", async () => {
    const register = (body: Record<string, unknown>) =>
      authFetch("/oauth2/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          redirect_uris: ["http://localhost:6274/oauth/callback"],
          token_endpoint_auth_method: "none",
          ...body,
        }),
      });
    expect((await register({ resources: [API] })).status).toBe(400);

    // What MCP clients send everywhere: the union of scopes. It is narrowed, not refused.
    const response = await register({ scope: "read write imports offline_access" });
    expect(response.status, await response.clone().text()).toBe(201);
    const client = (await response.json()) as { client_id: string; scope: string };
    expect(client.scope.split(" ").sort()).toEqual(["offline_access", "read"]);
    const links = await getDb()
      .select({ resource: oauthClientResources.resourceId })
      .from(oauthClientResources)
      .where(eq(oauthClientResources.clientId, client.client_id));
    expect(links.map((link) => link.resource)).toEqual([MCP]);

    // And the authorize endpoint will not start a flow for /api/v1 with it.
    const person = await ssoPerson();
    const query = new URLSearchParams({
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: "http://localhost:6274/oauth/callback",
      scope: "read",
      state: "s",
      code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      code_challenge_method: "S256",
      resource: API,
    });
    const authorize = await authFetch(`/oauth2/authorize?${query.toString()}`, {
      headers: person.headers,
      redirect: "manual",
    });
    const location = authorize.headers.get("location") ?? "";
    expect(location).not.toContain("/oauth/consent");
    expect(location.includes("error=invalid_target") || authorize.status === 400).toBe(true);
    query.set("scope", "read write");
    query.set("resource", MCP);
    const wider = await authFetch(`/oauth2/authorize?${query.toString()}`, {
      headers: person.headers,
      redirect: "manual",
    });
    expect(wider.headers.get("location") ?? "").toMatch(/error=invalid_scope/);
  });

  it("publishes the authorization server metadata under the issuer", async () => {
    const { oauthProviderAuthServerMetadata } = await import("@better-auth/oauth-provider");
    const metadata = (await (
      await oauthProviderAuthServerMetadata(await getAuth())(
        new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`),
      )
    ).json()) as Record<string, unknown>;
    expect(metadata.issuer).toBe(`${ORIGIN}/api/auth`);
    expect(metadata.token_endpoint).toBe(`${ORIGIN}/api/auth/oauth2/token`);
    expect(metadata.grant_types_supported).toEqual(
      expect.arrayContaining(["client_credentials", "authorization_code"]),
    );
  });
});

describe("the PAT transition (D4)", () => {
  it("keeps accepting a personal access token, and says so in the log", async () => {
    const person = await ssoPerson();
    const { token } = await createToken(
      { userId: person.userId },
      { name: "paperless", scopes: ["read"], expiresInDays: null },
    );
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const response = await callApi("/accounts", token);
    expect(response.status).toBe(200);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/^\[api\] legacy token used/));
    info.mockRestore();
  });
});
