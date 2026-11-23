import { beforeEach, describe, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({ value: {} as Record<string, string | undefined> }));
vi.mock("@ledgerly/domain/platform/env", () => ({ readEnv: () => env.value }));

const { grantDynamicHost } = await import("./egress");

const SECRET = "e".repeat(32);
const CREDENTIALS = { baseUrl: "https://trek.example.org/", clientId: "id", clientSecret: "secret" };

function recorder(status = 204) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  };
  return { calls, fetchFn: fetchFn as typeof fetch };
}

describe("the grant of a person's own host", () => {
  beforeEach(() => {
    env.value = { EGRESS_URL: "http://ledgerly-egress:8081", EGRESS_ADMIN_SECRET: SECRET };
  });

  it("sends the host of the credential the catalog names, for the plugin whose host is dynamic", async () => {
    const { calls, fetchFn } = recorder();
    await grantDynamicHost("trek", CREDENTIALS, fetchFn);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://ledgerly-egress:8081/grants");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${SECRET}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      plugin: "trek",
      host: "trek.example.org",
      ttlSeconds: 300,
    });
  });

  it("sends nothing for a plugin whose hosts are the catalog's", async () => {
    const { calls, fetchFn } = recorder();
    await grantDynamicHost("wallet", { token: "t", baseUrl: "https://x.example.org" }, fetchFn);
    expect(calls).toEqual([]);
  });

  it("sends nothing without a proxy, or without an address in the credential", async () => {
    const { calls, fetchFn } = recorder();
    await grantDynamicHost("trek", { ...CREDENTIALS, baseUrl: "not an address" }, fetchFn);
    env.value = {};
    await grantDynamicHost("trek", CREDENTIALS, fetchFn);
    expect(calls).toEqual([]);
  });

  it("does not throw when the proxy refuses the host or does not answer", async () => {
    await expect(grantDynamicHost("trek", CREDENTIALS, recorder(403).fetchFn)).resolves.toBeUndefined();
    const down = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(grantDynamicHost("trek", CREDENTIALS, down)).resolves.toBeUndefined();
  });
});
