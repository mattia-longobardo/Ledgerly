import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** A rotatable set of AES-256 keys parsed from `APP_ENCRYPTION_KEY`. The first key seals; every key can open. */
export interface KeyRing {
  activeId: string;
  keys: ReadonlyMap<string, Buffer>;
}

const KEY_ID = /^[a-z0-9_-]{1,32}$/;
const VERSION = 0x01;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Parses `APP_ENCRYPTION_KEY`: `"k2:<base64 32 bytes>,k1:<base64 32 bytes>"`. The first key seals.
 * Error messages never echo raw entry text (an operator typo can put a key where an id is expected):
 * a malformed id is reported by its position, not its content.
 */
export function parseKeyRing(spec: string): KeyRing {
  const entries = spec
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length === 0) throw new Error("APP_ENCRYPTION_KEY is empty");
  const keys = new Map<string, Buffer>();
  for (const [index, entry] of entries.entries()) {
    const separator = entry.indexOf(":");
    const id = separator > 0 ? entry.slice(0, separator) : "";
    const encoded = entry.slice(separator + 1);
    if (!KEY_ID.test(id)) {
      throw new Error(`Invalid key id in APP_ENCRYPTION_KEY entry ${index + 1}`);
    }
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) {
      throw new Error(`Key "${id}" must be 32 bytes of canonical base64`);
    }
    if (keys.has(id)) throw new Error(`Duplicate key id "${id}" in APP_ENCRYPTION_KEY`);
    keys.set(id, key);
  }
  return { activeId: [...keys.keys()][0], keys };
}

/**
 * Encrypts `plaintext` with AES-256-GCM under the ring's active key. The blob
 * layout is `0x01 | idLength (1 byte) | keyId (utf8) | iv (12) | tag (16) |
 * ciphertext`; the whole header (version, id length and id) is authenticated
 * as additional data, so a blob cannot be replayed under a different key id.
 */
export function seal(ring: KeyRing, plaintext: string): Buffer {
  const key = ring.keys.get(ring.activeId);
  if (!key) throw new Error(`Active key "${ring.activeId}" is missing`);
  const id = Buffer.from(ring.activeId, "utf8");
  const header = Buffer.concat([Buffer.from([VERSION, id.length]), id]);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(header);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([header, iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypts a blob produced by {@link seal}, looking up the key by the id
 * embedded in the blob. Never echoes blob bytes in an error: an id that does
 * not look like one {@link parseKeyRing} would accept is reported without its
 * value, and the ciphertext or plaintext are never included either.
 */
export function open(ring: KeyRing, blob: Buffer): string {
  if (blob.length < 2 || blob[0] !== VERSION) throw new Error("Unsupported ciphertext version");
  const idEnd = 2 + blob[1];
  if (blob.length < idEnd + IV_BYTES + TAG_BYTES) throw new Error("Ciphertext is truncated");
  const header = blob.subarray(0, idEnd);
  const idText = blob.subarray(2, idEnd).toString("utf8");
  const key = ring.keys.get(idText);
  if (!key) throw new Error(KEY_ID.test(idText) ? `Unknown key id "${idText}"` : "Unknown key id");
  const iv = blob.subarray(idEnd, idEnd + IV_BYTES);
  const tag = blob.subarray(idEnd + IV_BYTES, idEnd + IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(idEnd + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(header);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Seals a credential object (e.g. `{ token, baseUrl }`) as JSON. */
export function sealJson(ring: KeyRing, value: Record<string, string>): Buffer {
  return seal(ring, JSON.stringify(value));
}

/**
 * Opens a blob produced by {@link sealJson}, rejecting anything that is not a
 * flat string record. Invalid JSON is reported without the decrypted text:
 * `JSON.parse`'s own error would otherwise quote it verbatim.
 */
export function openJson(ring: KeyRing, blob: Buffer): Record<string, string> {
  const plaintext = open(ring, blob);
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new Error("Sealed credentials are not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Sealed credentials are not an object");
  }
  for (const value of Object.values(parsed)) {
    if (typeof value !== "string") throw new Error("Sealed credentials must be string values");
  }
  return parsed as Record<string, string>;
}
