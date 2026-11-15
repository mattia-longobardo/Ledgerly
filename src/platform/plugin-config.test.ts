import { describe, expect, it } from "vitest";
import { parsePluginConfig } from "./plugin-config";

const SECRET = "0123456789abcdef0123456789abcdef";

describe("the plugins of the configuration", () => {
  it("are none when nothing is configured: the app has no plugin", () => {
    expect(parsePluginConfig(undefined, undefined)).toEqual([]);
    expect(parsePluginConfig("", " ")).toEqual([]);
  });

  it("are read by id, with their address and the shared secret", () => {
    expect(
      parsePluginConfig(
        "enablebanking=http://ledgerly-plugin-enablebanking:8787/, other=https://other.example",
        `enablebanking=${SECRET},other=${SECRET}=x`,
      ),
    ).toEqual([
      { id: "enablebanking", url: "http://ledgerly-plugin-enablebanking:8787", secret: SECRET },
      { id: "other", url: "https://other.example", secret: `${SECRET}=x` },
    ]);
  });

  it.each([
    ["Enable=http://x", `Enable=${SECRET}`, "Invalid plugin id in PLUGIN_URLS entry 1"],
    ["a1=http://x,a1=http://y", `a1=${SECRET}`, 'Duplicate plugin "a1" in PLUGIN_URLS'],
    ["a1=ftp://x", `a1=${SECRET}`, 'Plugin "a1" has an address that is not an http(s) URL'],
    ["a1=not a url", `a1=${SECRET}`, 'Plugin "a1" has an address that is not an http(s) URL'],
    ["a1=http://x", undefined, 'Plugin "a1" needs a secret of 32+ characters in PLUGIN_SECRETS'],
    ["a1=http://x", "a1=short", 'Plugin "a1" needs a secret of 32+ characters in PLUGIN_SECRETS'],
    [undefined, `a1=${SECRET}`, 'Plugin "a1" has a secret and no address'],
  ])("refuses %s with %s", (urls, secrets, message) => {
    expect(() => parsePluginConfig(urls, secrets)).toThrow(message);
  });

  it("never quotes a secret in a refusal", () => {
    const secret = "do-not-print-me";
    for (const attempt of [
      () => parsePluginConfig("a1=http://x", `a1=${secret}`),
      () => parsePluginConfig("a1=http://x", secret),
    ]) {
      let message = "";
      try {
        attempt();
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe("");
      expect(message).not.toContain(secret);
    }
  });
});
