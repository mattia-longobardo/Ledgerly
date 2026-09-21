import { describe, expect, it } from "vitest";
import {
  allows,
  expiryFrom,
  hashSecret,
  mintToken,
  parseScopes,
  parseToken,
  sameHash,
  tokenState,
} from "./rules";

const NOW = new Date("2026-09-21T10:00:00Z");

describe("mintToken", () => {
  it("mints pat_<prefix>.<secret>, and the digest is of the secret alone", () => {
    const { token, prefix, hash } = mintToken();
    expect(token).toMatch(/^pat_[a-z0-9]{8}\.[A-Za-z0-9_-]{43}$/);
    expect(token.startsWith(`pat_${prefix}.`)).toBe(true);
    expect(hash).toBe(hashSecret(token.slice(`pat_${prefix}.`.length)));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never mints the same token twice", () => {
    const values = new Set(Array.from({ length: 50 }, () => mintToken().token));
    expect(values.size).toBe(50);
  });
});

describe("parseToken", () => {
  it("reads back what mintToken wrote", () => {
    const { token, prefix, hash } = mintToken();
    expect(parseToken(token)).toEqual({ prefix, hash });
  });

  it("ignores the whitespace of a pasted value", () => {
    const { token, prefix } = mintToken();
    expect(parseToken(`  ${token}  `)?.prefix).toBe(prefix);
  });

  it("refuses anything that is not one of ours", () => {
    for (const value of [
      "",
      "pat_",
      "not-a-token",
      "pat_ABCDEFGH.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "pat_abcdefgh.short",
      `Bearer ${mintToken().token}`,
      `${mintToken().token}x`,
    ]) {
      expect(parseToken(value), value).toBeNull();
    }
  });
});

describe("sameHash", () => {
  it("is true for the same digest and false for another of the same length", () => {
    const a = hashSecret("one");
    expect(sameHash(a, hashSecret("one"))).toBe(true);
    expect(sameHash(a, hashSecret("two"))).toBe(false);
  });

  it("is false, rather than throwing, for a value of another length", () => {
    expect(sameHash(hashSecret("one"), "beef")).toBe(false);
  });
});

describe("tokenState", () => {
  it("is active with no end date and no revocation", () => {
    expect(tokenState({ expiresAt: null, revokedAt: null }, NOW)).toBe("active");
  });

  it("is expired the instant the end date arrives", () => {
    expect(tokenState({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("expired");
    expect(tokenState({ expiresAt: new Date(NOW.getTime() + 1), revokedAt: null }, NOW)).toBe("active");
  });

  it("says revoked even when it had also expired", () => {
    expect(tokenState({ expiresAt: new Date("2020-01-01"), revokedAt: NOW }, NOW)).toBe("revoked");
  });
});

describe("allows and parseScopes", () => {
  it("answers only for the scope it carries", () => {
    expect(allows(["read"], "read")).toBe(true);
    expect(allows(["read"], "write")).toBe(false);
  });

  it("keeps the catalogue's order and refuses an empty or unknown set", () => {
    expect(parseScopes(["imports", "read"])).toEqual(["read", "imports"]);
    expect(parseScopes([])).toBeNull();
    expect(parseScopes(["admin"])).toBeNull();
    expect(parseScopes(["read", "admin"])).toBeNull();
  });
});

describe("expiryFrom", () => {
  it("is null for a token with no end date", () => {
    expect(expiryFrom(null, NOW)).toBeNull();
  });

  it("counts whole days from now", () => {
    expect(expiryFrom(30, NOW)?.toISOString()).toBe("2026-10-21T10:00:00.000Z");
  });
});
