import { describe, expect, it } from "vitest";
import { callPlugin, type Fetch, PluginCallError } from "./client";
import { SECRET_HEADER, verifyResponseSchema } from "@plugin-contract/calls";
import { acceptsContract, hasCapability, manifestSchema } from "@plugin-contract/manifest";

const PLUGIN = { id: "one", url: "http://plugin.test:8787", secret: "0123456789abcdef0123456789abcdef" };

function answering(status: number, body: unknown) {
  const seen: { url: string; init: RequestInit | undefined }[] = [];
  const fetchFn: Fetch = async (input, init) => {
    seen.push({ url: String(input), init });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { seen, fetchFn };
}

async function codeOf(work: Promise<unknown>): Promise<PluginCallError> {
  const error = await work.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(PluginCallError);
  return error as PluginCallError;
}

describe("a call to a plugin", () => {
  it("posts the body with the shared secret and reads the answer through the schema", async () => {
    const { seen, fetchFn } = answering(200, { access: "read-only", extra: "ignored" });
    const answer = await callPlugin(PLUGIN, "/verify", verifyResponseSchema, {
      body: { credentials: { a: "b" } },
      fetchFn,
    });
    expect(answer).toEqual({ access: "read-only" });
    expect(seen[0].url).toBe("http://plugin.test:8787/verify");
    expect(seen[0].init?.method).toBe("POST");
    expect((seen[0].init?.headers as Record<string, string>)[SECRET_HEADER]).toBe(PLUGIN.secret);
    expect(seen[0].init?.body).toBe('{"credentials":{"a":"b"}}');
  });

  it("is a GET with no body", async () => {
    const { seen, fetchFn } = answering(200, { access: "write" });
    await callPlugin(PLUGIN, "/manifest", verifyResponseSchema, { fetchFn });
    expect(seen[0].init?.method).toBe("GET");
    expect(seen[0].init?.body).toBeUndefined();
  });

  it("fails with the plugin's code, and the wait it names", async () => {
    const { fetchFn } = answering(429, { error: { code: "rate_limited", retryAfterSeconds: 21_600 } });
    const error = await codeOf(callPlugin(PLUGIN, "/sync", verifyResponseSchema, { body: {}, fetchFn }));
    expect(error).toMatchObject({ code: "rate_limited", retryAfterSeconds: 21_600, message: "rate_limited" });
  });

  it("is `plugin_down` when the plugin does not answer, refuses the secret, or answers outside the contract", async () => {
    const unreachable: Fetch = async () => {
      throw new TypeError("fetch failed: secret words");
    };
    for (const fetchFn of [
      unreachable,
      answering(401, { error: { code: "unauthorized" } }).fetchFn,
      answering(500, "<html>the plugin's own words</html>").fetchFn,
      answering(500, { error: { code: "made_up" } }).fetchFn,
      answering(200, "not json").fetchFn,
    ]) {
      const error = await codeOf(callPlugin(PLUGIN, "/verify", verifyResponseSchema, { body: {}, fetchFn }));
      expect(error.code).toBe("plugin_down");
      expect(error.message).toBe("plugin_down");
    }
  });

  it("is `invalid_data` when a good answer is not the contract's shape", async () => {
    const { fetchFn } = answering(200, { access: "everything" });
    expect(
      (await codeOf(callPlugin(PLUGIN, "/verify", verifyResponseSchema, { body: {}, fetchFn }))).code,
    ).toBe("invalid_data");
  });
});

describe("the manifest of the contract", () => {
  const manifest = {
    id: "one",
    version: "1.2.3",
    contract: "1",
    labels: { name: { en: "One", it: "Uno" }, description: { en: "A source", it: "Una sorgente" } },
    capabilities: ["provider.write", "aCapabilityOfTomorrow"],
    userSettings: [
      { name: "token", type: "secret", required: true, writeOnly: true, label: { en: "Token", it: "Token" } },
    ],
    connectionFields: [],
    egress: ["api.one.example"],
    schedule: { recommendedPerDay: 3, minIntervalMinutes: 360 },
    providesCategories: true,
  };

  it("has labels, credential fields, a minimum interval and capabilities (AN2)", () => {
    const parsed = manifestSchema.parse(manifest);
    expect(parsed.labels.steps).toEqual({});
    expect(parsed.labels.products).toEqual({});
    expect(parsed.userSettings[0]).toMatchObject({ name: "token", writeOnly: true });
    expect(parsed.schedule.minIntervalMinutes).toBe(360);
    expect(hasCapability(parsed, "provider.write")).toBe(true);
    expect(hasCapability(parsed, "categories")).toBe(false);
  });

  it("keeps a capability the core does not know, and ignores it", () => {
    expect(manifestSchema.parse(manifest).capabilities).toContain("aCapabilityOfTomorrow");
  });

  it.each([
    ["labels", { name: { en: "One" } }],
    ["userSettings", [{ name: "token", type: "secret" }]],
    ["schedule", { recommendedPerDay: 3 }],
    ["capabilities", "provider.write"],
    ["id", "Not An Id"],
  ])("refuses a manifest with a wrong %s", (key, value) => {
    expect(manifestSchema.safeParse({ ...manifest, [key]: value }).success).toBe(false);
  });

  it("accepts the contract this core speaks, and no other", () => {
    expect(acceptsContract("1")).toBe(true);
    expect(acceptsContract("2")).toBe(false);
  });
});
