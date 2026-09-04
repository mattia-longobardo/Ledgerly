import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { providerRegistry, registerProvider, resetProviderRegistry } from "./registry";
import type { IntegrationProvider, ProviderCode } from "./types";

function stub(code: ProviderCode): IntegrationProvider {
  return {
    code,
    label: code,
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "Token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {},
    onDisconnect: async () => {},
  };
}

describe("provider registry", () => {
  beforeEach(resetProviderRegistry);

  it("returns a registered provider and null for anything else", () => {
    registerProvider(stub("wallet"));
    expect(providerRegistry.get("wallet")?.label).toBe("wallet");
    expect(providerRegistry.get("nope")).toBeNull();
  });

  it("lists providers in registration order and refuses a duplicate", () => {
    registerProvider(stub("wallet"));
    registerProvider(stub("trek"));
    expect(providerRegistry.list().map((p) => p.code)).toEqual(["wallet", "trek"]);
    expect(() => registerProvider(stub("wallet"))).toThrow(/already registered/);
  });
});
