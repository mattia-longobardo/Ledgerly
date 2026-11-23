import { describe, expect, it } from "vitest";
import { decide, type Lookup } from "./access.ts";
import { Grants } from "./grants.ts";
import { readPolicy } from "./policy.ts";

const SECRET = "s".repeat(32);
const CATALOG = JSON.stringify({
  plugins: [
    { id: "source", egress: ["api.example.com"] },
    { id: "calendar", egress: [], dynamicHost: { credential: "baseUrl" } },
  ],
});
const policy = readPolicy(
  { EGRESS_SECRETS: `source=${SECRET},calendar=${SECRET}`, EGRESS_ADMIN_SECRET: "a".repeat(32) },
  CATALOG,
);
const basic = (id: string, secret = SECRET) => `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;

/** A resolver that answers from a table, and counts its calls. */
function resolver(table: Record<string, string[]>): Lookup & { calls: number } {
  const lookup = async (host: string) => {
    lookup.calls += 1;
    return (table[host] ?? []).map((address) => ({ address }));
  };
  lookup.calls = 0;
  return lookup;
}

const PUBLIC = { "api.example.com": ["93.184.215.14"], "trek.example.org": ["203.0.113.7"] };

function setup(table: Record<string, string[]> = PUBLIC) {
  return { policy, grants: new Grants(), lookup: resolver(table) };
}

describe("a CONNECT of a plugin", () => {
  it("goes to the checked address of a host of its catalog entry", async () => {
    const deps = setup();
    const decision = await decide(deps, { target: "api.example.com:443", authorization: basic("source") });
    expect(decision).toEqual({
      ok: true,
      plugin: "source",
      host: "api.example.com",
      address: "93.184.215.14",
    });
    expect(deps.lookup.calls).toBe(1);
  });

  it("is refused without credentials", async () => {
    const decision = await decide(setup(), { target: "api.example.com:443", authorization: undefined });
    expect(decision).toMatchObject({ ok: false, status: 407 });
  });

  it("is refused with another plugin's secret", async () => {
    const decision = await decide(setup(), {
      target: "api.example.com:443",
      authorization: basic("source", "x".repeat(32)),
    });
    expect(decision).toMatchObject({ ok: false, status: 407 });
  });

  it("is refused on a port that is not 443", async () => {
    const decision = await decide(setup(), { target: "api.example.com:80", authorization: basic("source") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "port" });
  });

  it("is refused for a host of no entry and no grant", async () => {
    const decision = await decide(setup(), {
      target: "evil.example.net:443",
      authorization: basic("source"),
    });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "host" });
  });

  it("is refused for the host of another plugin's entry", async () => {
    const decision = await decide(setup(), {
      target: "api.example.com:443",
      authorization: basic("calendar"),
    });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "host" });
  });

  it("is refused for a catalog host that resolves to a private address", async () => {
    const deps = setup({ "api.example.com": ["10.0.0.5"] });
    const decision = await decide(deps, { target: "api.example.com:443", authorization: basic("source") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "address" });
  });

  it("is refused when one of the addresses of a name is private", async () => {
    const deps = setup({ "api.example.com": ["93.184.215.14", "127.0.0.1"] });
    const decision = await decide(deps, { target: "api.example.com:443", authorization: basic("source") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "address" });
  });

  it("is refused for a name that does not resolve", async () => {
    const deps = setup({});
    const decision = await decide(deps, { target: "api.example.com:443", authorization: basic("source") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "address" });
  });

  it("goes to a granted host while the grant lives, and not after", async () => {
    const deps = setup();
    deps.grants.add("calendar", "trek.example.org", 60, 1_000);
    const request = { target: "trek.example.org:443", authorization: basic("calendar") };
    expect(await decide(deps, request, 30_000)).toMatchObject({ ok: true, address: "203.0.113.7" });
    expect(await decide(deps, request, 61_001)).toMatchObject({ ok: false, reason: "host" });
  });

  it("checks the granted host's address again at the connection (DNS rebinding)", async () => {
    const deps = setup({ "trek.example.org": ["127.0.0.1"] });
    deps.grants.add("calendar", "trek.example.org", 60);
    const decision = await decide(deps, { target: "trek.example.org:443", authorization: basic("calendar") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "address" });
  });

  it("is refused for an IP literal that no entry names", async () => {
    const decision = await decide(setup(), { target: "[::1]:443", authorization: basic("source") });
    expect(decision).toMatchObject({ ok: false, status: 403, reason: "host" });
  });
});

describe("the policy", () => {
  it("refuses a secret for a plugin that is not in the catalog", () => {
    expect(() =>
      readPolicy({ EGRESS_SECRETS: `other=${SECRET}`, EGRESS_ADMIN_SECRET: SECRET }, CATALOG),
    ).toThrow("not a plugin of the catalog");
  });

  it("refuses a short secret", () => {
    expect(() =>
      readPolicy({ EGRESS_SECRETS: "source=short", EGRESS_ADMIN_SECRET: SECRET }, CATALOG),
    ).toThrow("short");
  });

  it("refuses to start without the core's secret", () => {
    expect(() => readPolicy({ EGRESS_SECRETS: "" }, CATALOG)).toThrow("EGRESS_ADMIN_SECRET");
  });
});
