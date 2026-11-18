import { describe, expect, it } from "vitest";
import {
  discoveryUrlFor,
  issuerChanged,
  issuerFromDiscoveryUrl,
  issuerOrigin,
  oidcInputSchema,
} from "./oidc";

describe("discoveryUrlFor", () => {
  it("appends the well-known path without eating the last segment of the issuer", () => {
    expect(discoveryUrlFor("https://auth.example/application/o/ledgerly/")).toBe(
      "https://auth.example/application/o/ledgerly/.well-known/openid-configuration",
    );
  });

  it("adds the missing trailing slash rather than replacing the last segment", () => {
    expect(discoveryUrlFor("https://auth.example/application/o/ledgerly")).toBe(
      "https://auth.example/application/o/ledgerly/.well-known/openid-configuration",
    );
  });

  it("ignores the whitespace around a pasted value", () => {
    expect(discoveryUrlFor("  https://auth.example/o/app/  ")).toBe(
      "https://auth.example/o/app/.well-known/openid-configuration",
    );
  });
});

describe("issuerFromDiscoveryUrl", () => {
  it("is the inverse of discoveryUrlFor", () => {
    const issuer = "https://auth.example/application/o/ledgerly/";
    expect(issuerFromDiscoveryUrl(discoveryUrlFor(issuer))).toBe(issuer);
  });

  it("leaves a value that is already an issuer alone but for its slash", () => {
    expect(issuerFromDiscoveryUrl("https://auth.example/o/app")).toBe("https://auth.example/o/app/");
  });

  it("drops a query string, which no issuer carries", () => {
    expect(issuerFromDiscoveryUrl("https://auth.example/o/app/.well-known/openid-configuration?v=2")).toBe(
      "https://auth.example/o/app/",
    );
  });
});

describe("issuerChanged", () => {
  it("is false when nothing was saved before: there is no provider to leave", () => {
    expect(issuerChanged(null, "https://auth.example/o/app/")).toBe(false);
  });

  it("does not mistake a missing trailing slash for a different provider", () => {
    expect(issuerChanged("https://auth.example/o/app", "https://auth.example/o/app/")).toBe(false);
  });

  it("is true for a different host", () => {
    expect(issuerChanged("https://auth.example/o/app/", "https://auth.other/o/app/")).toBe(true);
  });

  it("is true for a different application on the same host", () => {
    expect(issuerChanged("https://auth.example/o/app/", "https://auth.example/o/other/")).toBe(true);
  });
});

describe("issuerOrigin", () => {
  it("is the scheme and host, without the path", () => {
    expect(issuerOrigin("https://auth.example/application/o/app/")).toBe("https://auth.example");
  });

  it("is null for something that is not a URL", () => {
    expect(issuerOrigin("auth.example")).toBeNull();
  });
});

describe("oidcInputSchema", () => {
  const valid = {
    issuer: "https://auth.example/o/app/",
    clientId: "ledgerly",
    clientSecret: "",
    adminGroup: "ledgerly-admins",
  };

  it("accepts an empty secret: an empty field keeps the sealed one", () => {
    expect(oidcInputSchema.safeParse(valid).success).toBe(true);
  });

  it("refuses an issuer that is not a URL", () => {
    expect(oidcInputSchema.safeParse({ ...valid, issuer: "auth.example" }).success).toBe(false);
  });

  it("refuses an empty client id and an empty admin group", () => {
    expect(oidcInputSchema.safeParse({ ...valid, clientId: "  " }).success).toBe(false);
    expect(oidcInputSchema.safeParse({ ...valid, adminGroup: "" }).success).toBe(false);
  });
});
