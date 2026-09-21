import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";

describe("contentSecurityPolicy", () => {
  it("allows the form post to the identity provider and nothing else", () => {
    const csp = contentSecurityPolicy({ authOrigin: "https://auth.example.test", dev: false });
    expect(csp).toContain("form-action 'self' https://auth.example.test");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("adds unsafe-eval only in development (Next dev needs it)", () => {
    expect(contentSecurityPolicy({ authOrigin: null, dev: true })).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ authOrigin: null, dev: false })).toMatch(/form-action 'self'$/);
  });
});
