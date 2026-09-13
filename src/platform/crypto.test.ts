import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { open, openJson, parseKeyRing, seal, sealJson } from "./crypto";

const key = () => randomBytes(32).toString("base64");

describe("key ring", () => {
  it("parses ids and keys, first one active", () => {
    const ring = parseKeyRing(`k2:${key()},k1:${key()}`);
    expect(ring.activeId).toBe("k2");
    expect([...ring.keys.keys()]).toEqual(["k2", "k1"]);
  });

  it.each([
    ["", "empty"],
    [`K1:${key()}`, "bad id"],
    [`k1:${randomBytes(16).toString("base64")}`, "short key"],
    [`k1:${key()},k1:${key()}`, "duplicate id"],
    ["k1-nokey", "missing separator"],
  ])("rejects %s (%s)", (spec) => {
    expect(() => parseKeyRing(spec)).toThrow();
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

  it("detects tampering", () => {
    const ring = parseKeyRing(`k1:${key()}`);
    const blob = seal(ring, "secret");
    blob[blob.length - 1] ^= 0xff;
    expect(() => open(ring, blob)).toThrow();
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
});
