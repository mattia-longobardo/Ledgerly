import { describe, expect, it, vi } from "vitest";

// A plugin of `PLUGIN_URLS` (the tests': `enablebanking`) taken as one the catalog does not list.
vi.mock("./catalog", () => ({ catalogEntry: () => null }));

const { configuredPlugins, listInstancePlugins, pluginDiagnostics } = await import("./queries");

describe("a plugin of the configuration that is not in the catalog (H27)", () => {
  it("is never called and never listed: only the diagnostics name it", async () => {
    expect(configuredPlugins()).toEqual([]);
    expect(await listInstancePlugins()).toEqual([]);
    expect(await pluginDiagnostics("en")).toEqual([
      {
        id: "enablebanking",
        name: "enablebanking",
        version: null,
        contract: null,
        state: "uncatalogued",
        at: null,
      },
    ]);
  });
});
