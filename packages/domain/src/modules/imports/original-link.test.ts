import { describe, expect, it } from "vitest";
import { checkLink, linkKey, signLink } from "./original-link";

const key = linkKey("a-secret-of-at-least-thirty-two-characters");
const claims = { documentId: "019a0000-0000-7000-8000-000000000001", userId: "user1", expiresAt: 1_000 };

describe("a signed link to an original", () => {
  it("opens for its document and person before it expires", () => {
    expect(checkLink(key, signLink(key, claims), 999)).toEqual({ ok: true, claims });
  });

  it("is refused once expired", () => {
    expect(checkLink(key, signLink(key, claims), 1_000)).toEqual({ ok: false, reason: "link_expired" });
  });

  it("is refused when any part of it was changed", () => {
    const token = signLink(key, claims);
    const [payload, signature] = token.split(".");
    const other = Buffer.from(`${claims.documentId}.user2.${claims.expiresAt}`).toString("base64url");
    const later = Buffer.from(`${claims.documentId}.${claims.userId}.9999`).toString("base64url");
    for (const altered of [
      `${other}.${signature}`,
      `${later}.${signature}`,
      `${payload}.${signature}x`,
      `${payload}.`,
      payload,
      `${token}.x`,
      "",
    ]) {
      expect(checkLink(key, altered, 0)).toEqual({ ok: false, reason: "link_invalid" });
    }
  });

  it("is refused when it was signed with another key", () => {
    const otherKey = linkKey("another-secret-of-at-least-thirty-two-chars");
    expect(checkLink(key, signLink(otherKey, claims), 0)).toEqual({ ok: false, reason: "link_invalid" });
  });

  it("never carries the secret: the key is derived from it", () => {
    expect(key.toString()).not.toContain("a-secret");
    expect(key).toHaveLength(32);
  });
});
