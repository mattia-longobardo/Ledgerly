import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialCryptoError, createCredentialCipher, parseEncryptionKeys } from "./crypto";

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("base64");

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
});
