import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  generateToken,
  hashToken,
  hashesMatch,
  intersectScopes,
  parseToken,
  TOKEN_PATTERN,
} from "./pat";
import { permissionsForRoles, type Permission } from "./permissions";

describe("generateToken", () => {
  it("produces pat_<8 base62>.<43 base64url>", () => {
    for (let i = 0; i < 50; i += 1) {
      const { token, prefix } = generateToken();
      expect(token).toMatch(TOKEN_PATTERN);
      expect(prefix).toHaveLength(8);
      expect(token).toBe(`pat_${prefix}.${token.split(".")[1]}`);
      expect(token.split(".")[1]).toHaveLength(43);
    }
  });

  it("returns the sha256 of the whole token, hex, and never the secret in the hash", () => {
    const { token, hash } = generateToken();
    expect(hash).toBe(createHash("sha256").update(token, "utf8").digest("hex"));
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token.split(".")[1]);
  });

  it("does not repeat itself", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateToken().token));
    expect(tokens.size).toBe(200);
  });
});

describe("hashToken", () => {
  it("is deterministic and differs for a one-character change", () => {
    const { token } = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});

describe("hashesMatch", () => {
  it("accepts equal hashes and refuses different, differently sized or empty ones", () => {
    const a = hashToken("pat_AAAAAAAA.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    const b = hashToken("pat_BBBBBBBB.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, b)).toBe(false);
    expect(hashesMatch(a, a.slice(0, 40))).toBe(false);
    expect(hashesMatch("", "")).toBe(false);
  });
});

describe("parseToken", () => {
  const { token } = generateToken();

  it("reads a well-formed Bearer header, whatever the case of the scheme", () => {
    expect(parseToken(`Bearer ${token}`)).toBe(token);
    expect(parseToken(`bearer ${token}`)).toBe(token);
    expect(parseToken(`BEARER ${token}`)).toBe(token);
    expect(parseToken(`  Bearer   ${token}  `)).toBe(token);
  });

  it("returns null for a missing, empty or non-Bearer header", () => {
    expect(parseToken(null)).toBeNull();
    expect(parseToken(undefined)).toBeNull();
    expect(parseToken("")).toBeNull();
    expect(parseToken(token)).toBeNull();
    expect(parseToken(`Basic ${token}`)).toBeNull();
    expect(parseToken("Bearer")).toBeNull();
    expect(parseToken("Bearer ")).toBeNull();
  });

  it("returns null for a Bearer credential that is not one of ours", () => {
    // Someone else's opaque token, and near misses on our own shape: a wrong
    // scheme prefix, a short secret, a prefix with a non-base62 character.
    expect(parseToken("Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig")).toBeNull();
    expect(parseToken(`Bearer pit_${token.slice(4)}`)).toBeNull();
    expect(parseToken("Bearer pat_AAAAAAAA.tooshort")).toBeNull();
    expect(parseToken("Bearer pat_AAAA-AAA.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBeNull();
  });
});

describe("intersectScopes", () => {
  const owner = permissionsForRoles(["owner"]);

  it("keeps only the scopes the user still holds", () => {
    const scoped = intersectScopes(owner, ["accounts.read", "accounts.write"]);
    expect([...scoped].sort()).toEqual(["accounts.read", "accounts.write"]);
  });

  it("shrinks when the user's role is downgraded — R8-5's live re-intersection", () => {
    const scopes: Permission[] = ["accounts.read", "accounts.write"];
    // The same token, the same scopes, against a viewer who has lost the write.
    const viewer = permissionsForRoles(["viewer"]);
    expect([...intersectScopes(viewer, scopes)]).toEqual(["accounts.read"]);
  });

  it("drops a scope the permission catalogue does not contain", () => {
    expect([...intersectScopes(owner, ["accounts.read", "not.a.permission"])]).toEqual(["accounts.read"]);
  });

  it("grants nothing for empty scopes", () => {
    expect([...intersectScopes(owner, [])]).toEqual([]);
  });
});
