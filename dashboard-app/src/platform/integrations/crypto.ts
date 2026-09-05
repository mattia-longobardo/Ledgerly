import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/** Anything wrong with a key, a blob, or the pairing of the two. Never carries the plaintext. */
export class CredentialCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialCryptoError";
  }
}

export interface SealedCredential {
  keyId: string;
  ciphertext: Buffer;
}

export interface CredentialCipher {
  readonly activeKeyId: string;
  seal(plaintext: Record<string, string>): SealedCredential;
  open(sealed: SealedCredential): Record<string, string>;
}

const KEY_ID = /^[a-z0-9_-]{1,32}$/;
const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * `APP_ENCRYPTION_KEY` is `keyId:base64key[,keyId:base64key]…` and insertion
 * order is meaningful: the FIRST entry is the active key, the rest exist only
 * so blobs written before a rotation can still be opened. A Map preserves that
 * order, which is why the return type is a Map and not a plain object.
 */
export function parseEncryptionKeys(raw: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e !== "");
  if (entries.length === 0) {
    throw new CredentialCryptoError("APP_ENCRYPTION_KEY is empty; expected keyId:base64key");
  }
  for (const entry of entries) {
    const separator = entry.indexOf(":");
    if (separator <= 0) {
      throw new CredentialCryptoError("APP_ENCRYPTION_KEY entry is not keyId:base64key");
    }
    const keyId = entry.slice(0, separator);
    if (!KEY_ID.test(keyId)) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY key id must match ${KEY_ID.source}`);
    }
    if (keys.has(keyId)) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY repeats the key id ${keyId}`);
    }
    const value = entry.slice(separator + 1);
    const key = Buffer.from(value, "base64");
    if (key.length !== 32) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY key ${keyId} is not 32 bytes once base64-decoded`);
    }
    // `Buffer.from(..., "base64")` is lenient — it silently drops characters
    // outside the base64 alphabet (whitespace, a stray symbol) instead of
    // failing, so a garbled key can still decode to a valid-looking 32 bytes.
    // Re-encoding and comparing (padding stripped, since a value may omit
    // the trailing `=`) is what catches that: a key that round-trips cleanly
    // is unambiguous, and one that doesn't would otherwise fail silently
    // later, as every credential sealed under it becoming undecryptable.
    if (key.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
      throw new CredentialCryptoError(`APP_ENCRYPTION_KEY key ${keyId} is not valid base64`);
    }
    keys.set(keyId, key);
  }
  return keys;
}

export function createCredentialCipher(raw: string): CredentialCipher {
  const keys = parseEncryptionKeys(raw);
  const activeKeyId = [...keys.keys()][0]!;

  return {
    activeKeyId,

    seal(plaintext) {
      const key = keys.get(activeKeyId)!;
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      // The key id is authenticated, not encrypted: a blob relabelled with a
      // different key id fails its tag check instead of silently decrypting.
      cipher.setAAD(Buffer.from(activeKeyId, "utf8"));
      const body = Buffer.concat([cipher.update(JSON.stringify(plaintext), "utf8"), cipher.final()]);
      return {
        keyId: activeKeyId,
        ciphertext: Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]),
      };
    },

    open(sealed) {
      const key = keys.get(sealed.keyId);
      if (!key) throw new CredentialCryptoError(`No key ${sealed.keyId} in APP_ENCRYPTION_KEY`);
      const blob = sealed.ciphertext;
      if (blob.length < 1 + IV_BYTES + TAG_BYTES || blob[0] !== VERSION) {
        throw new CredentialCryptoError("Credential blob is malformed");
      }
      const iv = blob.subarray(1, 1 + IV_BYTES);
      const tag = blob.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
      const body = blob.subarray(1 + IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(Buffer.from(sealed.keyId, "utf8"));
      decipher.setAuthTag(tag);
      let json: string;
      try {
        json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
      } catch {
        throw new CredentialCryptoError("Credential blob failed authentication");
      }
      // JSON.parse must stay guarded: on failure Node embeds the offending
      // input in a native SyntaxError message, and at this point that input
      // is decrypted credential material. Letting that error escape would
      // leak plaintext into whatever catches it upstream.
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new CredentialCryptoError("Credential blob did not contain JSON");
      }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new CredentialCryptoError("Credential blob did not contain an object");
      }
      // The check above proves only that `parsed` is a non-null, non-array
      // object — not that every value in it is a string. Without this, a
      // blob holding a nested object (or a number, a boolean) for one of its
      // fields would be handed back cast to `Record<string, string>` while
      // actually holding something else. The message names no field value:
      // this is decrypted credential material, and a message built from it
      // would risk leaking plaintext to whatever catches this error.
      if (Object.values(parsed).some((v) => typeof v !== "string")) {
        throw new CredentialCryptoError("Credential blob contained a non-string field");
      }
      return parsed as Record<string, string>;
    },
  };
}

let cached: CredentialCipher | null = null;

/** The process-wide cipher. Memoised because parsing the key list is pure. */
export function credentialCipher(): CredentialCipher {
  if (!cached) cached = createCredentialCipher(env().APP_ENCRYPTION_KEY);
  return cached;
}

/** Test seam: `credentialCipher()` is memoised and the environment changes between cases. */
export function resetCredentialCipher(): void {
  cached = null;
}
