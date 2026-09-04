import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hmacSignatureVerifier, verifyHmacSignature, webhookEventName } from "./webhook-signature";

const SECRET = "shhh";
const BODY = '{"event":"sync.requested"}';
const GOOD = `sha256=${createHmac("sha256", SECRET).update(BODY, "utf8").digest("hex")}`;

describe("verifyHmacSignature", () => {
  it("accepts a correct sha256 signature, with or without the prefix", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: SECRET })).toBe(true);
    expect(
      verifyHmacSignature({ rawBody: BODY, presented: GOOD.slice("sha256=".length), secret: SECRET }),
    ).toBe(true);
  });

  it("rejects a missing, empty, malformed, wrong-body and wrong-secret signature", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: null, secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: "", secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: "sha256=zz", secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: "{}", presented: GOOD, secret: SECRET })).toBe(false);
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: "other" })).toBe(false);
  });

  it("rejects everything when the secret is empty", () => {
    expect(verifyHmacSignature({ rawBody: BODY, presented: GOOD, secret: "" })).toBe(false);
  });
});

describe("hmacSignatureVerifier", () => {
  it("reads the signature off the header and verifies the raw body", () => {
    const verify = hmacSignatureVerifier();
    const headers = new Headers({ "x-signature": GOOD });
    expect(verify({ rawBody: BODY, headers }, SECRET)).toBe(true);
    expect(verify({ rawBody: BODY, headers }, "other")).toBe(false);
    expect(verify({ rawBody: BODY, headers: new Headers() }, SECRET)).toBe(false);
  });

  it("can be pointed at a different header name", () => {
    const verify = hmacSignatureVerifier("x-hub-signature-256");
    expect(verify({ rawBody: BODY, headers: new Headers({ "x-hub-signature-256": GOOD }) }, SECRET)).toBe(true);
    expect(verify({ rawBody: BODY, headers: new Headers({ "x-signature": GOOD }) }, SECRET)).toBe(false);
  });
});

describe("webhookEventName", () => {
  it("reads a string event and falls back to \"unknown\" for anything else", () => {
    expect(webhookEventName({ event: "accounts.changed" })).toBe("accounts.changed");
    expect(webhookEventName({ event: 7 })).toBe("unknown");
    expect(webhookEventName({})).toBe("unknown");
    expect(webhookEventName(null)).toBe("unknown");
    expect(webhookEventName([{ event: "x" }])).toBe("unknown");
    expect(webhookEventName("accounts.changed")).toBe("unknown");
  });
});
