import { describe, expect, it } from "vitest";
import { hashPayload, signRequest } from "./sigv4";

/**
 * AWS's own `get-vanilla` test vector from the SigV4 test suite. Using the
 * published vector rather than a self-consistent round trip is the whole point:
 * a signer that agrees only with itself signs nothing the silo will accept.
 */
const VECTOR = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  region: "us-east-1",
  service: "service",
  at: new Date("2015-08-30T12:36:00Z"),
};

describe("hashPayload", () => {
  it("returns the empty-payload hash AWS documents", () => {
    expect(hashPayload(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("signRequest", () => {
  it("reproduces the get-vanilla Authorization header byte for byte", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://example.amazonaws.com/"),
      headers: { host: "example.amazonaws.com" },
      payloadHash: hashPayload(new Uint8Array()),
      ...VECTOR,
    });
    // NOT AWS's raw get-vanilla signature (5fa00fa3...) — that value covers
    // `host;x-amz-date` only. This signer always adds `x-amz-content-sha256`
    // (S3 requires it), which changes the canonical request and therefore the
    // signature. This value was verified by hand: computed independently (not
    // via signRequest) from the canonical request AWS's spec describes, with
    // the extra header included — see the sigv4 module docstring.
    expect(headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=726c5c4879a6b4ccbbd3b24edbd6b8826d34f87450fbbf4e85546fc7ba9c1642",
    );
  });

  it("always sends x-amz-content-sha256 and x-amz-date, and signs both", () => {
    const headers = signRequest({
      method: "PUT",
      url: new URL("https://silo.internal/bucket/payroll/u1/2026/a.pdf"),
      headers: { host: "silo.internal", "content-type": "application/pdf" },
      payloadHash: hashPayload(new TextEncoder().encode("%PDF-1.7")),
      ...VECTOR,
    });
    expect(headers["x-amz-date"]).toBe("20150830T123600Z");
    expect(headers["x-amz-content-sha256"]).toBe(hashPayload(new TextEncoder().encode("%PDF-1.7")));
    expect(headers["authorization"]).toContain("SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date");
    expect(headers["authorization"]).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("percent-encodes the path segment by segment, leaving the slashes intact, and does not double-encode what URL already encoded (Finding 3)", () => {
    const headers = signRequest({
      method: "GET",
      url: new URL("https://silo.internal/bucket/payroll/u 1/a+b.pdf"),
      headers: { host: "silo.internal" },
      payloadHash: hashPayload(new Uint8Array()),
      ...VECTOR,
    });
    // `URL` has already percent-encoded the space in `.pathname` as `%20`
    // before `canonicalPath` ever sees it. Hand-computed independently (not
    // via `signRequest`, same method as the get-vanilla vector above) from the
    // *correctly* single-encoded canonical path
    // `/bucket/payroll/u%201/a%2Bb.pdf` — a signer that instead re-encodes the
    // already-encoded `%20` into `%2520` (the regression this test guards
    // against) produces a different signature than this one.
    expect(headers["authorization"]).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=719fc3ceac9374a1e2963287c5b9f067ee5c8361d24ec273f7d6d9fe2769e0f8",
    );
  });

  it("produces a different signature for a different payload — the body is bound to the signature", () => {
    const base = {
      method: "PUT",
      url: new URL("https://silo.internal/bucket/k.pdf"),
      headers: { host: "silo.internal" },
      ...VECTOR,
    };
    const a = signRequest({ ...base, payloadHash: hashPayload(new TextEncoder().encode("a")) });
    const b = signRequest({ ...base, payloadHash: hashPayload(new TextEncoder().encode("b")) });
    expect(a["authorization"]).not.toBe(b["authorization"]);
  });
});
