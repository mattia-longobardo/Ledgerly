import { describe, expect, it } from "vitest";
import {
  AUTHORIZE_PATH,
  authorizeContinuation,
  registrationApplicationType,
  issuerFor,
  protectedResourceMetadata,
  redirectHosts,
  registrationRedirectsAllowed,
  registrationScope,
  resourceFor,
  resourceMetadataUrl,
  safeNext,
} from "./oauth";

const BASE = "https://dash.example.test";

describe("OAuth addresses", () => {
  it("derives the issuer, the resources and their metadata from the base URL", () => {
    expect(issuerFor(`${BASE}/`)).toBe(`${BASE}/api/auth`);
    expect(resourceFor(BASE, "api")).toBe(`${BASE}/api/v1`);
    expect(resourceMetadataUrl(BASE, "mcp")).toBe(`${BASE}/.well-known/oauth-protected-resource/api/mcp`);
    expect(protectedResourceMetadata(BASE, "api")).toMatchObject({
      resource: `${BASE}/api/v1`,
      authorization_servers: [`${BASE}/api/auth`],
      scopes_supported: ["read", "write", "imports", "investments:read"],
    });
    // The MCP is read-only: a client that asks for what the metadata offers asks for the two reads.
    expect(protectedResourceMetadata(BASE, "mcp").scopes_supported).toEqual(["read", "investments:read"]);
  });
});

describe("dynamic registration (PERS-49 SEC-01)", () => {
  it("accepts loopback http and the allowlisted callbacks, and nothing else", () => {
    const ok = (uris: unknown) => registrationRedirectsAllowed({ redirect_uris: uris });
    expect(ok(["http://localhost:6274/oauth/callback"])).toBe(true);
    expect(ok(["http://127.0.0.1:33418/callback", "http://[::1]:9/cb"])).toBe(true);
    expect(ok(["https://claude.ai/api/mcp/auth_callback"])).toBe(true);
    expect(ok(["https://claude.com/api/mcp/auth_callback"])).toBe(true);
    expect(ok(["https://evil.example/cb"])).toBe(false);
    expect(ok(["https://claude.ai/api/mcp/auth_callback/../evil"])).toBe(false);
    expect(ok(["https://claude.ai.evil.example/api/mcp/auth_callback"])).toBe(false);
    expect(ok(["http://localhost:1/cb", "https://evil.example/cb"])).toBe(false);
    expect(ok(["https://localhost/cb"])).toBe(false);
    expect(ok([])).toBe(false);
    expect(ok(undefined)).toBe(false);
    expect(registrationRedirectsAllowed(null)).toBe(false);
  });

  it("narrows the requested scope to read and offline_access", () => {
    expect(registrationScope({ scope: "read write imports offline_access" })).toBe("read offline_access");
    expect(registrationScope({ scope: "write" })).toBe("read");
    expect(registrationScope({})).toBe("read");
    expect(registrationScope({ scope: "offline_access" })).toBe("offline_access");
  });

  it("names the hosts a client's redirects go to, once each", () => {
    expect(
      redirectHosts([
        "https://claude.ai/api/mcp/auth_callback",
        "https://claude.ai/x",
        "http://localhost:6274/cb",
      ]),
    ).toEqual(["claude.ai", "localhost:6274"]);
  });
});

describe("authorizeContinuation", () => {
  it("rebuilds the authorize request without the signature and without prompt", () => {
    const next = authorizeContinuation({
      response_type: "code",
      client_id: "abc",
      scope: "read offline_access",
      prompt: "login",
      sig: "x",
      exp: "1",
      ba_iat: "2",
    });
    expect(next).toBe(`${AUTHORIZE_PATH}?response_type=code&client_id=abc&scope=read+offline_access`);
  });

  it("is null for anything that is not an authorization request", () => {
    expect(authorizeContinuation({ error: "x" })).toBeNull();
    expect(authorizeContinuation({ client_id: "abc" })).toBeNull();
  });
});

describe("safeNext", () => {
  it("allows only the app and this server's authorize endpoint", () => {
    expect(safeNext(`${AUTHORIZE_PATH}?client_id=a`)).toBe(`${AUTHORIZE_PATH}?client_id=a`);
    expect(safeNext("https://evil.test/")).toBe("/");
    expect(safeNext("//evil.test")).toBe("/");
    expect(safeNext(`${AUTHORIZE_PATH}`)).toBe("/");
    expect(safeNext(`${AUTHORIZE_PATH}?a=\\evil`)).toBe("/");
    expect(safeNext(null)).toBe("/");
  });
});

describe("registrationApplicationType", () => {
  it("makes a client with only loopback http redirects a native one", () => {
    expect(registrationApplicationType({ redirect_uris: ["http://localhost:6274/oauth/callback"] })).toBe(
      "native",
    );
    expect(
      registrationApplicationType({
        redirect_uris: ["http://127.0.0.1:33418/callback", "http://[::1]:9/cb"],
      }),
    ).toBe("native");
  });

  it("leaves everything else as it came", () => {
    expect(registrationApplicationType({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] })).toBe(
      undefined,
    );
    // Mixed: the plugin judges it as a web client, as it would without this rule.
    expect(
      registrationApplicationType({ redirect_uris: ["http://localhost/cb", "https://example.com/cb"] }),
    ).toBe(undefined);
    expect(registrationApplicationType({ redirect_uris: ["http://localhost.evil.test/cb"] })).toBe(undefined);
    expect(registrationApplicationType({ redirect_uris: ["https://localhost/cb"] })).toBe(undefined);
    expect(
      registrationApplicationType({ application_type: "web", redirect_uris: ["http://localhost/cb"] }),
    ).toBe(undefined);
    expect(registrationApplicationType({ redirect_uris: [] })).toBe(undefined);
    expect(registrationApplicationType({ redirect_uris: ["not a url"] })).toBe(undefined);
    expect(registrationApplicationType(undefined)).toBe(undefined);
  });
});
