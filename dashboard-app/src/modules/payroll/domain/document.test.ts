import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, looksLikePdf, newStorageKey, sha256Hex } from "./document";

const pdf = (extra = "") => new TextEncoder().encode(`%PDF-1.7\n${extra}`);

describe("looksLikePdf", () => {
  it("accepts the %PDF- magic bytes", () => {
    expect(looksLikePdf(pdf())).toBe(true);
  });

  it("rejects a file whose declared type lies about its content", () => {
    expect(looksLikePdf(new TextEncoder().encode("<html><body>gotcha"))).toBe(false);
  });

  it("rejects a file shorter than the magic itself, without throwing", () => {
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });

  it("rejects a PDF whose magic is not at offset 0", () => {
    expect(looksLikePdf(new TextEncoder().encode("   %PDF-1.7"))).toBe(false);
  });
});

describe("sha256Hex", () => {
  it("returns the well-known digest of the empty input, lowercase and 64 chars", () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is stable across two calls with equal bytes", () => {
    expect(sha256Hex(pdf("a"))).toBe(sha256Hex(pdf("a")));
    expect(sha256Hex(pdf("a"))).not.toBe(sha256Hex(pdf("b")));
  });
});

describe("newStorageKey", () => {
  const userId = "00000000-0000-7000-8000-000000000001";

  it("namespaces by user and year and ends in .pdf", () => {
    const key = newStorageKey(userId, new Date("2026-08-31T22:30:00Z"));
    expect(key).toMatch(new RegExp(`^payroll/${userId}/2026/[0-9a-f]{32}\\.pdf$`));
  });

  it("uses the Rome calendar year, not UTC", () => {
    // 2025-12-31T23:30Z is already 2026-01-01 in Europe/Rome.
    expect(newStorageKey(userId, new Date("2025-12-31T23:30:00Z"))).toContain("/2026/");
  });

  it("is unguessable: two keys for the same user and instant differ", () => {
    const at = new Date("2026-08-31T22:30:00Z");
    expect(newStorageKey(userId, at)).not.toBe(newStorageKey(userId, at));
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("is the spec's 10 MB (§7.9), matching the database CHECK on size_bytes", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10485760);
  });
});
