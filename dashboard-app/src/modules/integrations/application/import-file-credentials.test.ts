import { describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import type { IntegrationDeps } from "./deps";
import { importFileCredentials } from "./import-file-credentials";

const principal = testPrincipal();

function stub(code: "wallet" | "trek"): IntegrationProvider {
  return {
    code,
    label: code,
    capabilities: code === "wallet" ? ["accounts"] : ["leave"],
    credentialSchema:
      code === "wallet"
        ? z.object({ token: z.string().min(1) })
        : z.object({ baseUrl: z.url(), token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" || code === "trek" ? stub(code) : null),
    list: () => [stub("wallet"), stub("trek")],
  };
  return testIntegrationDeps({ registry });
}

describe("importFileCredentials", () => {
  it("imports both tokens into encrypted connections", async () => {
    const deps = makeDeps();
    const result = await importFileCredentials(deps)(principal, {
      wallet: { token: "wallet-token" },
      trek: { baseUrl: "https://trek.example", token: "trek_token" },
    });
    expect(result.imported.sort()).toEqual(["trek", "wallet"]);
    const wallet = await deps.connections.getByProvider(principal.userId, "wallet");
    const sealed = await deps.connections.readCredentials(principal.userId, wallet!.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "wallet-token" });
  });

  it("skips a provider with no file and one that is already connected", async () => {
    const deps = makeDeps();
    await importFileCredentials(deps)(principal, { wallet: { token: "first" } });
    const second = await importFileCredentials(deps)(principal, { wallet: { token: "second" } });
    expect(second.imported).toEqual([]);
    expect(second.skipped).toEqual([
      { provider: "wallet", reason: "already_connected" },
      { provider: "trek", reason: "no_file" },
    ]);
    const wallet = await deps.connections.getByProvider(principal.userId, "wallet");
    const sealed = await deps.connections.readCredentials(principal.userId, wallet!.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "first" });
  });
});
