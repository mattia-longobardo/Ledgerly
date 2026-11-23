import { Readable } from "node:stream";
import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { answerAdmin } from "./admin.ts";
import { Grants } from "./grants.ts";
import { readPolicy } from "./policy.ts";

const ADMIN = "a".repeat(32);
const policy = readPolicy(
  { EGRESS_ADMIN_SECRET: ADMIN },
  JSON.stringify({
    plugins: [
      { id: "source", egress: ["api.example.com"] },
      { id: "calendar", egress: [], dynamicHost: { credential: "baseUrl" } },
    ],
  }),
);
const TABLE: Record<string, string[]> = {
  "trek.example.org": ["203.0.113.7"],
  "inside.example.org": ["192.168.1.20"],
  "rebind.example.org": ["203.0.113.8", "169.254.169.254"],
};

function setup() {
  const lookup = async (host: string) => (TABLE[host] ?? []).map((address) => ({ address }));
  return { policy, grants: new Grants(), lookup };
}

/** A request as `node:http` hands it, with a JSON body. */
function request(
  body: unknown,
  init: { method?: string; url?: string; token?: string } = {},
): IncomingMessage {
  const stream = Readable.from([JSON.stringify(body)]);
  return Object.assign(stream, {
    method: init.method ?? "POST",
    url: init.url ?? "/grants",
    headers: { authorization: `Bearer ${init.token ?? ADMIN}` },
  }) satisfies Pick<IncomingMessage, "method" | "url" | "headers"> as unknown as IncomingMessage;
}

const grant = (host: string, plugin = "calendar") => ({ plugin, host, ttlSeconds: 300 });

describe("POST /grants", () => {
  it("opens the person's host of a dynamic plugin for a short time", async () => {
    const deps = setup();
    expect(await answerAdmin(deps, request(grant("Trek.Example.org")))).toMatchObject({ status: 204 });
    expect(deps.grants.allows("calendar", "trek.example.org")).toBe(true);
    expect(deps.grants.allows("calendar", "trek.example.org", Date.now() + 301_000)).toBe(false);
  });

  it("is refused without the core's secret", async () => {
    const answer = await answerAdmin(setup(), request(grant("trek.example.org"), { token: "b".repeat(32) }));
    expect(answer.status).toBe(401);
  });

  it("is refused for a plugin whose host is not dynamic", async () => {
    expect((await answerAdmin(setup(), request(grant("trek.example.org", "source")))).status).toBe(403);
  });

  it("is refused for a host that resolves to a private address", async () => {
    expect(await answerAdmin(setup(), request(grant("inside.example.org")))).toMatchObject({
      status: 403,
      reason: "address",
    });
  });

  it("is refused for a host with one link-local address among public ones", async () => {
    expect((await answerAdmin(setup(), request(grant("rebind.example.org")))).status).toBe(403);
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "[::1]",
    "localhost",
    "trek.example.org:8443",
    "https://trek.example.org",
  ])("is refused for %s, which is not a host name", async (host) => {
    expect(await answerAdmin(setup(), request(grant(host)))).toMatchObject({ status: 403 });
  });

  it("is refused for a body that is not a grant", async () => {
    expect((await answerAdmin(setup(), request({ plugin: "calendar" }))).status).toBe(400);
  });

  it("answers the health check without a secret, and nothing else", async () => {
    expect(
      (await answerAdmin(setup(), request({}, { method: "GET", url: "/health", token: "" }))).status,
    ).toBe(200);
    expect((await answerAdmin(setup(), request({}, { method: "GET", url: "/grants" }))).status).toBe(404);
  });
});
