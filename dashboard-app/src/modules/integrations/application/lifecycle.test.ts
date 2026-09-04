import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { PermissionDeniedError } from "@/platform/auth/principal";
import type { IntegrationProvider, ProviderRegistry, TestResult } from "@/platform/integrations/types";
import { testIntegrationDeps } from "@/test/integration-deps";
import type { IntegrationDeps } from "./deps";
import { connectIntegration } from "./connect-integration";
import { disconnectIntegration } from "./disconnect-integration";
import { listIntegrations } from "./list-integrations";
import { openConnection } from "./open-connection";
import { testIntegrationConnection } from "./test-integration-connection";
import {
  ConnectionNotFoundError,
  ConnectionVersionMismatchError,
  CredentialValidationError,
  UnknownProviderError,
} from "./errors";

const principal = testPrincipal();

let nextTest: TestResult;
let disconnects: string[];

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1) }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => nextTest,
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => [],
        apply: async () => ({}),
      },
    },
    onDisconnect: async (ctx) => {
      disconnects.push(ctx.policy);
    },
  };
}

/** Only the registry differs per test file; everything else comes from the shared factory. */
function makeDeps(): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return testIntegrationDeps({ registry });
}

describe("integration lifecycle", () => {
  beforeEach(() => {
    nextTest = { ok: true, message: "Reached the provider." };
    disconnects = [];
  });

  it("connects, seals the credential and never returns it", async () => {
    const deps = makeDeps();
    const { connection, test } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "secret" },
    });
    expect(test.ok).toBe(true);
    expect(connection.status).toBe("connected");
    expect(JSON.stringify(connection)).not.toContain("secret");
    const sealed = await deps.connections.readCredentials(principal.userId, connection.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "secret" });
  });

  it("records a failed test as an error status with the message", async () => {
    const deps = makeDeps();
    nextTest = { ok: false, message: "401 from the provider" };
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "bad" },
    });
    expect(connection.status).toBe("error");
    expect(connection.lastError).toBe("401 from the provider");
  });

  it("reconnecting replaces the credential on the same row", async () => {
    const deps = makeDeps();
    const first = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "one" },
    });
    const second = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "two" },
    });
    expect(second.connection.id).toBe(first.connection.id);
    const sealed = await deps.connections.readCredentials(principal.userId, second.connection.id);
    expect(deps.cipher.open(sealed!)).toEqual({ token: "two" });
  });

  it("refuses a credential the provider's schema rejects, and an unknown provider", async () => {
    const deps = makeDeps();
    await expect(
      connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "" } }),
    ).rejects.toBeInstanceOf(CredentialValidationError);
    await expect(
      connectIntegration(deps)(principal, { provider: "trek", credentials: { token: "x" } }),
    ).rejects.toBeInstanceOf(UnknownProviderError);
  });

  it("refuses a principal without integrations.manage", async () => {
    const deps = makeDeps();
    const viewer = testPrincipal({ roles: ["viewer"] });
    await expect(
      connectIntegration(deps)(viewer, { provider: "wallet", credentials: { token: "x" } }),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("tests an existing connection and stamps the result", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    nextTest = { ok: false, message: "gone" };
    const result = await testIntegrationConnection(deps)(principal, "wallet");
    expect(result.ok).toBe(false);
    const connection = await deps.connections.getByProvider(principal.userId, "wallet");
    expect(connection?.status).toBe("error");
    expect(connection?.lastTestAt).toEqual(new Date("2026-09-04T09:00:00Z"));
  });

  it("refuses to test a provider that was never connected", async () => {
    const deps = makeDeps();
    await expect(testIntegrationConnection(deps)(principal, "wallet")).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });

  it("disconnects: credential gone, status disconnected, provider hook called with the policy", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
      disconnectPolicy: "archive",
    });
    const result = await disconnectIntegration(deps)(principal, "wallet");
    expect(result.policy).toBe("archive");
    expect(disconnects).toEqual(["archive"]);
    expect(await deps.connections.readCredentials(principal.userId, connection.id)).toBeNull();
    expect((await deps.connections.getByProvider(principal.userId, "wallet"))?.status).toBe("disconnected");
  });

  it("an explicit policy overrides the stored one", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    const result = await disconnectIntegration(deps)(principal, "wallet", "purge");
    expect(result.policy).toBe("purge");
    expect(disconnects).toEqual(["purge"]);
  });

  it("lists every registered provider, connected or not", async () => {
    const deps = makeDeps();
    const before = await listIntegrations(deps)(principal);
    expect(before).toHaveLength(1);
    expect(before[0]!.connection).toBeNull();
    expect(before[0]!.credentialFields.map((f) => f.name)).toEqual(["token"]);
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t" } });
    const after = await listIntegrations(deps)(principal);
    expect(after[0]!.connection?.status).toBe("connected");
  });

  it("creates one enabled sync job per implemented kind, and does not reset it on reconnect", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
    });
    const job = await deps.jobs.find(connection.id, "accounts");
    expect(job?.schedule).toBe("daily");
    expect(job?.enabled).toBe(true);
    expect(await deps.jobs.find(connection.id, "leave")).toBeNull();

    await deps.jobs.setCursor(job!.id, { since: "2026-09-01" });
    await connectIntegration(deps)(principal, { provider: "wallet", credentials: { token: "t2" } });
    const after = await deps.jobs.find(connection.id, "accounts");
    // Reconnecting replaces the credential, not the schedule state.
    expect(after?.id).toBe(job!.id);
    expect(after?.cursor).toEqual({ since: "2026-09-01" });
  });

  it("refuses to apply settings onto a connection somebody else has changed (Ruling P2-C9)", async () => {
    const deps = makeDeps();
    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
      settings: { note: "first" },
    });
    // Somebody else's write lands between the read and the update.
    await deps.connections.update(principal.userId, connection.id, connection.version, {
      settings: { note: "theirs" },
    });
    // Hand the use case the version it read a moment ago, which is now stale.
    Object.assign(deps.connections, { getByProvider: async () => connection });
    await expect(
      connectIntegration(deps)(principal, {
        provider: "wallet",
        credentials: { token: "t" },
        settings: { note: "mine" },
      }),
    ).rejects.toBeInstanceOf(ConnectionVersionMismatchError);
    // The losing write left nothing behind: the stored settings are still theirs.
    expect((await deps.connections.get(principal.userId, connection.id))?.settings).toEqual({
      note: "theirs",
    });
  });

  it("openConnection answers null until the connection is usable and credentialled", async () => {
    const deps = makeDeps();
    expect(await openConnection(deps)(principal.userId, "wallet")).toBeNull();

    const { connection } = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t" },
    });
    expect((await openConnection(deps)(principal.userId, "wallet"))?.credentials).toEqual({ token: "t" });

    await deps.connections.recordState(connection.id, { status: "disabled" });
    expect(await openConnection(deps)(principal.userId, "wallet")).toBeNull();
  });
});
