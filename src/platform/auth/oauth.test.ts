import { describe, expect, it } from "vitest";
import {
  AUTHORIZE_PATH,
  authorizeContinuation,
  issuerFor,
  protectedResourceMetadata,
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
      scopes_supported: ["read", "write", "imports"],
    });
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
