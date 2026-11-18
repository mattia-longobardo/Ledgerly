import { describe, expect, it } from "vitest";
import { probeOidc } from "./oidc-probe";

const CONFIG = {
  issuer: "https://auth.example/o/app/",
  discoveryUrl: "https://auth.example/o/app/.well-known/openid-configuration",
};

function answering(body: unknown, ok = true): typeof fetch {
  return (async () => ({ ok, json: async () => body }) as unknown as Response) as typeof fetch;
}

const NOW = new Date("2026-09-21T07:10:00Z");
const deps = (fetchImpl: typeof fetch) => ({ fetch: fetchImpl, now: () => NOW });

describe("probeOidc", () => {
  it("is ok for a document that names the same issuer and both endpoints", async () => {
    const result = await probeOidc(
      CONFIG,
      deps(
        answering({
          issuer: CONFIG.issuer,
          authorization_endpoint: "https://auth.example/o/authorize/",
          token_endpoint: "https://auth.example/o/token/",
        }),
      ),
    );
    expect(result).toEqual({ outcome: "ok", checkedAt: NOW });
  });

  it("does not mind a trailing slash the provider leaves off its own issuer", async () => {
    const result = await probeOidc(
      CONFIG,
      deps(
        answering({
          issuer: "https://auth.example/o/app",
          authorization_endpoint: "https://auth.example/o/authorize/",
          token_endpoint: "https://auth.example/o/token/",
        }),
      ),
    );
    expect(result.outcome).toBe("ok");
  });

  it("reports a document that names another issuer", async () => {
    const result = await probeOidc(
      CONFIG,
      deps(
        answering({
          issuer: "https://auth.other/o/app/",
          authorization_endpoint: "https://auth.other/o/authorize/",
          token_endpoint: "https://auth.other/o/token/",
        }),
      ),
    );
    expect(result.outcome).toBe("issuerMismatch");
  });

  it("reports a body that is not an OpenID configuration", async () => {
    const result = await probeOidc(CONFIG, deps(answering({ hello: "world" })));
    expect(result.outcome).toBe("invalidDocument");
  });

  it("reports an answer that is not 2xx as unreachable", async () => {
    const result = await probeOidc(CONFIG, deps(answering({}, false)));
    expect(result.outcome).toBe("unreachable");
  });

  it("never lets the reason of a failed fetch escape", async () => {
    const throwing = (async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:443");
    }) as unknown as typeof fetch;
    expect(await probeOidc(CONFIG, deps(throwing))).toEqual({ outcome: "unreachable", checkedAt: NOW });
  });
});
