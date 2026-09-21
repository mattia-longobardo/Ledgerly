import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, openJson, parseKeyRing, seal, sealJson } from "./crypto";

const key = () => randomBytes(32).toString("base64");

/** Locates the tag's first byte inside a blob, from the documented layout (header, then a 12-byte IV, then the tag). */
const tagOffset = (blob: Buffer) => 2 + blob[1] + 12;

describe("key ring", () => {
  it("parses ids and keys, first one active", () => {
    const ring = parseKeyRing(`k2:${key()},k1:${key()}`);
    expect(ring.activeId).toBe("k2");
    expect([...ring.keys.keys()]).toEqual(["k2", "k1"]);
  });

  it.each([
    ["", "empty", /^APP_ENCRYPTION_KEY is empty$/],
    [`K1:${key()}`, "bad id", /^Invalid key id in APP_ENCRYPTION_KEY entry 1$/],
    [
      `k1:${randomBytes(16).toString("base64")}`,
      "short key",
      /^Key "k1" must be 32 bytes of canonical base64$/,
    ],
    [`k1:${key()},k1:${key()}`, "duplicate id", /^Duplicate key id "k1" in APP_ENCRYPTION_KEY$/],
    ["k1-nokey", "missing separator", /^Invalid key id in APP_ENCRYPTION_KEY entry 1$/],
  ])("rejects %s (%s)", (spec, _label, expected) => {
    expect(() => parseKeyRing(spec)).toThrow(expected);
  });

  it("never echoes raw entry text when an id is invalid", () => {
    const leaked = key();
    expect(() => parseKeyRing(`${leaked}:k1`)).toThrow("Invalid key id in APP_ENCRYPTION_KEY entry 1");
    try {
      parseKeyRing(`${leaked}:k1`);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(leaked);
    }
  });
});

describe("seal / open", () => {
  it("round-trips and uses a fresh IV every time", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const a = seal(ring, "wallet-token-123");
    const b = seal(ring, "wallet-token-123");
    expect(open(ring, a)).toBe("wallet-token-123");
    expect(a.equals(b)).toBe(false);
  });

  it("detects tampering with the ciphertext", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => open(ring, tampered)).toThrow();
  });

  it("detects tampering with the auth tag", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    const tampered = Buffer.from(blob);
    tampered[tagOffset(tampered)] ^= 0xff;
    expect(() => open(ring, tampered)).toThrow();
  });

  it("rejects a blob with a truncated auth tag", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    const truncated = blob.subarray(0, blob.length - 20);
    expect(() => open(ring, truncated)).toThrow("Ciphertext is truncated");
  });

  it("rejects an empty-plaintext blob cut down to a short tag", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "");
    const truncated = blob.subarray(0, blob.length - 5);
    expect(() => open(ring, truncated)).toThrow("Ciphertext is truncated");
  });

  it("rejects a blob relabelled to a different key id", () => {
    const ring = parseKeyRing(`k1:${key()},k2:${key()}`);
    const blob = seal(ring, "secret"); // sealed under k1 (the active/first key)
    const relabeled = Buffer.from(blob);
    relabeled.write("k2", 2, "utf8"); // overwrite the id bytes only; iv/tag/ciphertext are untouched
    expect(() => open(ring, relabeled)).toThrow();
  });

  it("does not echo control bytes in an unrecognized key id", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    const evil = Buffer.from(blob);
    evil[2] = 0x0a; // newline and NUL in place of the "k1" id bytes: not a valid key id
    evil[3] = 0x00;
    expect(() => open(ring, evil)).toThrow("Unknown key id");
  });

  it("opens values sealed with a retired key after rotation", () => {
    const oldKey = key();
    const before = parseKeyRing(`k1:${oldKey}`);
    const blob = seal(before, "secret");
    const after = parseKeyRing(`k2:${key()},k1:${oldKey}`);
    expect(open(after, blob)).toBe("secret");
    expect(() => open(parseKeyRing(`k2:${key()}`), blob)).toThrow(/Unknown key id/);
  });

  it("seals JSON credential objects", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = sealJson(ring, { token: "abc", baseUrl: "https://trek.example" });
    expect(openJson(ring, blob)).toEqual({ token: "abc", baseUrl: "https://trek.example" });
  });

  it("does not leak the decrypted text when sealed data is not JSON", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "not-json-but-secret");
    expect(() => openJson(ring, blob)).toThrow("Sealed credentials are not valid JSON");
    try {
      openJson(ring, blob);
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("not-json-but-secret");
    }
  });

  it("rejects JSON that is not a flat object", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    expect(() => openJson(ring, seal(ring, JSON.stringify([1, 2, 3])))).toThrow(
      "Sealed credentials are not an object",
    );
    expect(() => openJson(ring, seal(ring, JSON.stringify("just a string")))).toThrow(
      "Sealed credentials are not an object",
    );
    expect(() => openJson(ring, seal(ring, JSON.stringify(null)))).toThrow(
      "Sealed credentials are not an object",
    );
  });

  it("rejects JSON objects with non-string values", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, JSON.stringify({ token: "abc", limit: 5 }));
    expect(() => openJson(ring, blob)).toThrow("Sealed credentials must be string values");
  });

  it("surfaces open()'s real error for a truncated blob instead of a JSON error", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = sealJson(ring, { token: "abc" });
    const truncated = blob.subarray(0, blob.length - 20);
    expect(() => openJson(ring, truncated)).toThrow("Ciphertext is truncated");
  });

  it("surfaces open()'s real error for a tampered blob instead of a JSON error", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = sealJson(ring, { token: "abc" });
    const tampered = Buffer.from(blob);
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => openJson(ring, tampered)).not.toThrow("Sealed credentials are not valid JSON");
    expect(() => openJson(ring, tampered)).toThrow();
  });
});
