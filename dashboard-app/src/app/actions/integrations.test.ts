import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import {
  setIntegrationDepsFactoryForTests,
  setIntegrationPrincipalForTests,
} from "@/modules/integrations/ui/run";

// Mirrors `actions/accounts.test.ts`: outside a real request, `revalidatePath`
// throws ("static generation store missing"), so every action test mocks it.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { connectIntegrationAction, disconnectIntegrationAction, syncIntegrationAction } = await import(
  "./integrations"
);

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async (credentials) =>
      credentials.token === "good" ? { ok: true, message: "Reached." } : { ok: false, message: "Refused." },
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => ["row"],
        apply: async () => ({ created: 2 }),
      },
    },
    onDisconnect: async () => {},
  };
}

let deps: IntegrationDeps;

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

describe("integration server actions", () => {
  beforeEach(() => {
    const registry: ProviderRegistry = {
      get: (code) => (code === "wallet" ? provider() : null),
      list: () => [provider()],
    };
    deps = testIntegrationDeps({ registry });
    setIntegrationDepsFactoryForTests(() => deps);
    setIntegrationPrincipalForTests(testPrincipal());
  });

  afterEach(() => {
    setIntegrationDepsFactoryForTests(null);
    setIntegrationPrincipalForTests(null);
  });

  it("connects from a form and reports the test outcome", async () => {
    const result = await connectIntegrationAction(
      form({ provider: "wallet", "credentials.token": "good" }),
    );
    expect(result).toEqual({ ok: true, data: { status: "connected", message: "Reached." } });
  });

  it("reports a rejected credential without failing the action", async () => {
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "bad" }));
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.status).toBe("error");
  });

  it("refuses an empty credential with a readable message", async () => {
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "" }));
    expect(result).toEqual({ ok: false, error: "Check the fields and try again." });
  });

  it("syncs with no kind field, defaulting to the provider's only sync, and disconnects", async () => {
    await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "good" }));
    // No `kind` in the form: `runSync` supplies the default, which is why the
    // action does not have to (and cannot disagree with the REST route).
    const synced = await syncIntegrationAction(form({ provider: "wallet" }));
    expect(synced.ok && synced.data.status).toBe("success");
    expect(synced.ok && synced.data.kind).toBe("accounts");
    const disconnected = await disconnectIntegrationAction(form({ provider: "wallet", policy: "archive" }));
    expect(disconnected).toEqual({ ok: true, data: { policy: "archive" } });
  });

  it("tells a viewer they may not change integrations", async () => {
    setIntegrationPrincipalForTests(testPrincipal({ roles: ["viewer"] }));
    const result = await connectIntegrationAction(form({ provider: "wallet", "credentials.token": "good" }));
    expect(result).toEqual({ ok: false, error: "You do not have permission to change integrations." });
  });
});
