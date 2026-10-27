import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet } from "jose";
import { describe, expect, it } from "vitest";
import { bearerChallenge, looksLikeJwt, principalOf, verifyAccessJwt } from "./access-token-rules";

const ISSUER = "https://dash.example.test/api/auth";
const API = "https://dash.example.test/api/v1";
const USER = "019a0000-0000-7000-8000-000000000001";

async function keys() {
  const { publicKey, privateKey } = await generateKeyPair("EdDSA", { extractable: true });
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "EdDSA" };
  return { privateKey, set: createLocalJWKSet({ keys: [jwk] }) };
}

async function sign(
  privateKey: CryptoKey,
  claims: Record<string, unknown>,
  { typ = "at+jwt", exp = "1h" }: { typ?: string; exp?: string } = {},
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "EdDSA", kid: "k1", typ })
    .setIssuer(ISSUER)
    .setAudience((claims.aud as string) ?? API)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(privateKey);
}

describe("verifyAccessJwt", () => {
  it("accepts an access token for this resource and reads its client and scopes", async () => {
    const { privateKey, set } = await keys();
    const token = await sign(privateKey, { sub: USER, client_id: "c1", scope: "read imports" });
    expect(await verifyAccessJwt(token, set, { issuer: ISSUER, audience: API })).toEqual({
      sub: USER,
      clientId: "c1",
      scopes: ["read", "imports"],
    });
  });

  it("refuses another audience, another issuer, another typ, an expired token and a foreign key", async () => {
    const { privateKey, set } = await keys();
    const expected = { issuer: ISSUER, audience: API };
    const base = { sub: USER, client_id: "c1", scope: "read" };
    expect(
      await verifyAccessJwt(
        await sign(privateKey, { ...base, aud: "https://dash.example.test/api/mcp" }),
        set,
        expected,
      ),
    ).toBeNull();
    expect(
      await verifyAccessJwt(await sign(privateKey, base), set, { ...expected, issuer: "https://evil.test" }),
    ).toBeNull();
    expect(await verifyAccessJwt(await sign(privateKey, base, { typ: "JWT" }), set, expected)).toBeNull();
    expect(await verifyAccessJwt(await sign(privateKey, base, { exp: "-1m" }), set, expected)).toBeNull();
    const other = await keys();
    expect(await verifyAccessJwt(await sign(other.privateKey, base), set, expected)).toBeNull();
    expect(await verifyAccessJwt("not.a.jwt", set, expected)).toBeNull();
  });

  it("refuses a token without a client", async () => {
    const { privateKey, set } = await keys();
    const token = await sign(privateKey, { sub: USER, scope: "read" });
    expect(await verifyAccessJwt(token, set, { issuer: ISSUER, audience: API })).toBeNull();
  });
});

describe("principalOf", () => {
  const claims = { sub: USER, clientId: "c1", scopes: ["read", "openid", "nope"] };

  it("is the consenting person for a user token, with only the domain scopes", () => {
    expect(principalOf(claims, { clientId: "c1", userId: null, disabled: false })).toEqual({
      userId: USER,
      clientId: "c1",
      scopes: ["read"],
    });
  });

  it("is the client's owner for a client_credentials token", () => {
    const machine = { sub: "c1", clientId: "c1", scopes: ["imports"] };
    expect(principalOf(machine, { clientId: "c1", userId: USER, disabled: null })?.userId).toBe(USER);
    expect(principalOf(machine, { clientId: "c1", userId: null, disabled: null })).toBeNull();
  });

  it("is nobody when the client is gone, disabled, or owned by someone else", () => {
    expect(principalOf(claims, null)).toBeNull();
    expect(principalOf(claims, { clientId: "c1", userId: null, disabled: true })).toBeNull();
    expect(principalOf(claims, { clientId: "c2", userId: null, disabled: false })).toBeNull();
    expect(
      principalOf(claims, {
        clientId: "c1",
        userId: "019a0000-0000-7000-8000-000000000002",
        disabled: false,
      }),
    ).toBeNull();
  });
});

describe("helpers", () => {
  it("tells a JWT from a personal token", () => {
    expect(looksLikeJwt("aaa.bbb.ccc")).toBe(true);
    expect(looksLikeJwt("pat_abcdefgh.secret")).toBe(false);
  });

  it("builds the RFC 6750 / RFC 9728 challenge", () => {
    const url = "https://dash.example.test/.well-known/oauth-protected-resource/api/v1";
    expect(bearerChallenge(url)).toBe(`Bearer resource_metadata="${url}"`);
    expect(bearerChallenge(url, { error: "insufficient_scope", scope: "write" })).toBe(
      `Bearer error="insufficient_scope", resource_metadata="${url}", scope="write"`,
    );
  });
});
