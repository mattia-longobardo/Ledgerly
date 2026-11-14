import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/platform/auth/provider", () => ({ identityProviderUrl: () => null }));

const { proxy, config } = await import("./proxy");

const ORIGIN = "https://ledgerly.example.test";
const anonymous = (path: string) => proxy(new NextRequest(`${ORIGIN}${path}`));
const signedIn = (path: string) =>
  proxy(
    new NextRequest(`${ORIGIN}${path}`, {
      headers: { cookie: "__Secure-better-auth.session_token=anything" },
    }),
  );

/** Next's "carry on" answer has no status of its own to tell it by: it is the absence of a redirect. */
const passes = (response: Response) => response.status === 200 && !response.headers.has("location");
const sentToSignIn = (response: Response) =>
  response.status === 307 && response.headers.get("location") === `${ORIGIN}/sign-in`;

describe("proxy", () => {
  it("lets an anonymous visitor read the two public documents", () => {
    for (const path of ["/privacy", "/terms", "/privacy?lang=it", "/terms?lang=en"])
      expect(passes(anonymous(path)), path).toBe(true);
  });

  it("lets an anonymous visitor reach the sign-in pages", () => {
    for (const path of [
      "/sign-in",
      "/sign-in/two-factor",
      "/forgot-password",
      "/reset-password",
      "/invite/abc",
    ])
      expect(passes(anonymous(path)), path).toBe(true);
  });

  it("still sends an anonymous visitor of every other page to sign-in", () => {
    for (const path of [
      "/",
      "/accounts",
      "/expenses",
      "/investments",
      "/payroll",
      "/settings/profile",
      "/settings/users",
      "/oauth/consent",
      // A name that only starts like a public one is not public.
      "/privacy-export",
      "/termsheet",
      "/settings/privacy",
    ])
      expect(sentToSignIn(anonymous(path)), path).toBe(true);
  });

  it("lets a request with a session cookie through", () => {
    expect(passes(signedIn("/accounts"))).toBe(true);
  });

  it("sets the content security policy on every answer, public or not", () => {
    for (const response of [anonymous("/privacy"), anonymous("/accounts"), signedIn("/")])
      expect(response.headers.get("content-security-policy")).toContain("default-src");
  });

  it("runs on the two public documents, so that they get the policy too", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    expect(matcher.test("/privacy")).toBe(true);
    expect(matcher.test("/terms")).toBe(true);
  });
});
