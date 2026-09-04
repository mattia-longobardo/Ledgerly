import { createCipheriv, randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  CredentialCryptoError,
  createCredentialCipher,
  credentialCipher,
  parseEncryptionKeys,
  resetCredentialCipher,
} from "./crypto";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");

/** Every required env() variable except APP_ENCRYPTION_KEY, which each test sets itself. */
const BASE_ENV: Record<string, string> = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://dashboard:pw@localhost:5432/dashboard",
  AUTH_URL: "https://dashboard.example",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  OIDC_ISSUER: "https://auth.example/application/o/dashboard/",
  OIDC_CLIENT_ID: "dashboard",
  OIDC_CLIENT_SECRET: "client-secret",
  AUTHORIZED_SUB: "00000000-0000-0000-0000-000000000001",
  PAPERLESS_URL: "https://paperless.example",
  PAPERLESS_TOKEN: "paperless-token",
  CRON_SECRET: "c".repeat(20),
  WEBHOOK_SECRET: "w".repeat(20),
};

/**
 * Builds a blob with the same layout `seal()` produces (version || iv || tag ||
 * body) but with an arbitrary body instead of `JSON.stringify(...)`, so tests
 * can authenticate-but-not-JSON without going through `seal()`.
 */
function sealRawBody(keyId: string, key: Buffer, plaintextBody: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(keyId, "utf8"));
  const body = Buffer.concat([cipher.update(plaintextBody, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), body]);
}

describe("parseEncryptionKeys", () => {
  it("reads a comma-separated list, active key first", () => {
    const keys = parseEncryptionKeys(`k2:${K2},k1:${K1}`);
    expect([...keys.keys()]).toEqual(["k2", "k1"]);
    expect(keys.get("k1")).toHaveLength(32);
  });

  it("refuses an empty value, a bad key id, a short key and a duplicate id", () => {
    expect(() => parseEncryptionKeys("")).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`BAD ID:${K1}`)).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`k1:${randomBytes(16).toString("base64")}`)).toThrow(CredentialCryptoError);
    expect(() => parseEncryptionKeys(`k1:${K1},k1:${K2}`)).toThrow(CredentialCryptoError);
  });
});

describe("credential cipher", () => {
  it("round-trips a credential under the active key", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const sealed = cipher.seal({ token: "wallet-secret" });
    expect(sealed.keyId).toBe("k1");
    expect(sealed.ciphertext.toString("utf8")).not.toContain("wallet-secret");
    expect(cipher.open(sealed)).toEqual({ token: "wallet-secret" });
  });

  it("produces a different blob every time", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const a = cipher.seal({ token: "same" });
    const b = cipher.seal({ token: "same" });
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it("still opens a blob sealed under a retired key", () => {
    const old = createCredentialCipher(`k1:${K1}`);
    const sealed = old.seal({ token: "old-secret" });
    const rotated = createCredentialCipher(`k2:${K2},k1:${K1}`);
    expect(rotated.activeKeyId).toBe("k2");
    expect(rotated.open(sealed)).toEqual({ token: "old-secret" });
  });

  it("refuses an unknown key id, a tampered blob and a relabelled blob", () => {
    const cipher = createCredentialCipher(`k1:${K1}`);
    const sealed = cipher.seal({ token: "x" });
    expect(() => cipher.open({ keyId: "nope", ciphertext: sealed.ciphertext })).toThrow(CredentialCryptoError);
    const tampered = Buffer.from(sealed.ciphertext);
    tampered[tampered.length - 1]! ^= 0xff;
    expect(() => cipher.open({ keyId: "k1", ciphertext: tampered })).toThrow(CredentialCryptoError);
    const two = createCredentialCipher(`k2:${K2},k1:${K1}`);
    const underK2 = two.seal({ token: "x" });
    expect(() => two.open({ keyId: "k1", ciphertext: underK2.ciphertext })).toThrow(CredentialCryptoError);
  });

  it("never lets decrypted plaintext escape via a JSON.parse SyntaxError", () => {
    // A blob that authenticates under the real key but whose decrypted body is
    // not JSON — seal() never produces this, but open() must still fail closed
    // with CredentialCryptoError rather than a native SyntaxError that would
    // embed the plaintext in its message.
    const secretLookingBody = "wallet-secret-abc-not-json";
    const ciphertext = sealRawBody("k1", Buffer.from(K1, "base64"), secretLookingBody);
    const cipher = createCredentialCipher(`k1:${K1}`);

    let caught: unknown;
    try {
      cipher.open({ keyId: "k1", ciphertext });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(CredentialCryptoError);
    expect(String((caught as Error).message)).not.toContain(secretLookingBody);
  });
});

describe("credentialCipher() / resetCredentialCipher()", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    Object.assign(process.env, BASE_ENV);
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = originalKey;
    resetEnvCache();
    resetCredentialCipher();
  });

  it("rebuilds from the current APP_ENCRYPTION_KEY after resetCredentialCipher(), rather than returning the memoised cipher", () => {
    process.env.APP_ENCRYPTION_KEY = `a1:${K1}`;
    resetEnvCache();
    resetCredentialCipher();
    expect(credentialCipher().activeKeyId).toBe("a1");

    // Without resetCredentialCipher() here, credentialCipher() would keep
    // returning the "a1" instance memoised above.
    process.env.APP_ENCRYPTION_KEY = `a2:${K2}`;
    resetEnvCache();
    resetCredentialCipher();
    expect(credentialCipher().activeKeyId).toBe("a2");
  });
});
