import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { testPrincipal } from "@/test/principal";
import { testIntegrationDeps } from "@/test/integration-deps";
import { CredentialCryptoError, type CredentialCipher, type SealedCredential } from "@/platform/integrations/crypto";
import type { IntegrationProvider, ProviderRegistry } from "@/platform/integrations/types";
import { hmacSignatureVerifier } from "@/platform/integrations/webhook-signature";
import { memoryCipher, type MemoryWebhookDeliveriesRepository } from "../infrastructure/memory-repositories";
import type { SyncJob, SyncJobsRepository } from "./ports";
import { connectIntegration } from "./connect-integration";
import type { IntegrationDeps } from "./deps";
import { drainSyncQueue } from "./drain-sync-queue";
import { handleWebhook } from "./handle-webhook";

const principal = testPrincipal();
const BODY = '{"event":"accounts.changed"}';
const SECRET = "hook-secret";

let syncs: number;

function provider(): IntegrationProvider {
  return {
    code: "wallet",
    label: "Budget Makers Wallet",
    capabilities: ["accounts"],
    credentialSchema: z.object({ token: z.string().min(1), webhookSecret: z.string().optional().default("") }),
    credentialFields: [{ name: "token", label: "API token", secret: true }],
    testConnection: async () => ({ ok: true, message: "ok" }),
    syncs: {
      accounts: {
        schedule: "daily",
        fetch: async () => {
          syncs += 1;
          return ["row"];
        },
        apply: async () => ({ created: 1 }),
      },
    },
    webhook: {
      verify: hmacSignatureVerifier(),
      toSyncRequests: () => [{ kind: "accounts", event: "accounts.changed" }],
    },
    onDisconnect: async () => {},
  };
}

function makeDeps(overrides: Partial<IntegrationDeps> = {}): IntegrationDeps {
  const registry: ProviderRegistry = {
    get: (code) => (code === "wallet" ? provider() : null),
    list: () => [provider()],
  };
  return testIntegrationDeps({ registry, ...overrides });
}

function signature(secret: string): Headers {
  return new Headers({
    "x-signature": `sha256=${createHmac("sha256", secret).update(BODY, "utf8").digest("hex")}`,
  });
}

describe("handleWebhook", () => {
  beforeEach(() => {
    syncs = 0;
  });

  it("accepts a correctly signed body, queues the sync and does NOT run it", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const outcome = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature(SECRET),
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.runIds).toHaveLength(1);
    // Spec §3.4: the request enqueues, it does not do the work.
    expect(syncs).toBe(0);
    const queued = await deps.runs.queued(10);
    expect(queued.map((r) => r.id)).toEqual(outcome.runIds);
    expect(queued[0]!.status).toBe("queued");
    expect(queued[0]!.trigger).toBe("webhook");

    const deliveries = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows;
    expect(deliveries[0]!.status).toBe("accepted");
    expect(deliveries[0]!.event).toBe("accounts.changed");
    expect(deliveries[0]!.connectionId).toBe(outcome.connectionId);

    // …and the tick is what actually runs it.
    const drained = await drainSyncQueue(deps)(10);
    expect(drained.map((r) => r.id)).toEqual(outcome.runIds);
    expect(drained[0]!.status).toBe("success");
    expect(syncs).toBe(1);
  });

  it("rejects a body that is signed but not JSON, with a reason on the delivery", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const raw = "not json at all";
    const headers = new Headers({
      "x-signature": `sha256=${createHmac("sha256", SECRET).update(raw, "utf8").digest("hex")}`,
    });
    const outcome = await handleWebhook(deps)({ provider: "wallet", rawBody: raw, headers });
    expect(outcome.accepted).toBe(false);
    expect(outcome.runIds).toEqual([]);
    expect(await deps.runs.queued(10)).toEqual([]);
    const delivery = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows[0]!;
    expect(delivery.status).toBe("rejected");
    expect(delivery.event).toBe("malformed_json");
    expect(delivery.error).toMatch(/JSON/);
    // The connection IS known here — the signature verified — so the row says which.
    expect(delivery.connectionId).not.toBeNull();
  });

  it("rejects a wrong signature, an unknown provider and a connection with no secret", async () => {
    const deps = makeDeps();
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });
    const wrong = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature("not-the-secret"),
    });
    expect(wrong.accepted).toBe(false);
    expect(syncs).toBe(0);
    expect(await deps.runs.queued(10)).toEqual([]);
    expect((deps.deliveries as MemoryWebhookDeliveriesRepository).rows[0]!.status).toBe("rejected");

    const unknown = await handleWebhook(deps)({
      provider: "nope",
      rawBody: BODY,
      headers: signature(SECRET),
    });
    expect(unknown.accepted).toBe(false);

    const noSecret = makeDeps();
    await connectIntegration(noSecret)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: "" },
    });
    const result = await handleWebhook(noSecret)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature(""),
    });
    expect(result.accepted).toBe(false);
  });

  it("attributes a delivery to the one connection whose own secret verifies it, never another", async () => {
    const deps = makeDeps();
    const userB = testPrincipal({ userId: "00000000-0000-7000-8000-000000000002" });
    const connectionA = await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: "secret-a" },
    });
    const connectionB = await connectIntegration(deps)(userB, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: "secret-b" },
    });

    // Signed with B's secret: must resolve to B even though A is also a
    // connected candidate for the same provider — a signature verified under
    // one connection's secret must never be attributed to another.
    const outcome = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature("secret-b"),
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.connectionId).toBe(connectionB.connection.id);
    expect(outcome.connectionId).not.toBe(connectionA.connection.id);

    const queued = await deps.runs.queued(10);
    expect(queued).toHaveLength(1);
    expect(queued[0]!.connectionId).toBe(connectionB.connection.id);
  });

  it("skips a connection whose credential blob fails to decrypt, rather than denying every other candidate", async () => {
    // Wraps the memory cipher so opening connection A's specific blob throws
    // `CredentialCryptoError` — standing in for a real blob whose `keyId` has
    // rotated out of `APP_ENCRYPTION_KEY`, or one that is simply malformed.
    const inner = memoryCipher();
    const flaky: CredentialCipher = {
      activeKeyId: inner.activeKeyId,
      seal: inner.seal,
      open: (sealed: SealedCredential) => {
        const data = inner.open(sealed);
        if (data.token === "broken") throw new CredentialCryptoError("Credential blob is malformed");
        return data;
      },
    };
    const deps = makeDeps({ cipher: flaky });

    const userB = testPrincipal({ userId: "00000000-0000-7000-8000-000000000003" });
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "broken", webhookSecret: "secret-a" },
    });
    const connectionB = await connectIntegration(deps)(userB, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: "secret-b" },
    });

    const outcome = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature("secret-b"),
    });
    expect(outcome.accepted).toBe(true);
    expect(outcome.connectionId).toBe(connectionB.connection.id);
    expect(outcome.runIds).toHaveLength(1);
    const deliveries = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows;
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.status).toBe("accepted");
  });

  it("rejects with a reason, and records the delivery, when the matched sync is switched off", async () => {
    // Stands in for a `sync_jobs` row with `enabled: false`. `setSyncJobEnabled`
    // can now write that, but faking it at the port keeps this test about the
    // webhook path and not about how the flag got there.
    const disabledJobs: SyncJobsRepository = {
      ensure: async (input): Promise<SyncJob> => ({ id: "job-1", ...input, enabled: false, cursor: null }),
      find: async (connectionId, kind): Promise<SyncJob | null> => ({
        id: "job-1",
        connectionId,
        kind,
        schedule: "daily",
        enabled: false,
        cursor: null,
      }),
      listForConnection: async () => [],
      setCursor: async () => {},
      setEnabled: async () => null,
    };
    const deps = makeDeps({ jobs: disabledJobs });
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });

    const outcome = await handleWebhook(deps)({
      provider: "wallet",
      rawBody: BODY,
      headers: signature(SECRET),
    });
    // Verified-but-refused: not the flat "unverifiable" rejection (the
    // signature and connection ARE known), but no run is queued and no sync
    // is left silently un-attempted — it is recorded so the delivery is
    // traceable.
    expect(outcome.accepted).toBe(false);
    expect(outcome.runIds).toEqual([]);
    expect(await deps.runs.queued(10)).toEqual([]);
    const delivery = (deps.deliveries as MemoryWebhookDeliveriesRepository).rows[0]!;
    expect(delivery.status).toBe("rejected");
    expect(delivery.connectionId).not.toBeNull();
    expect(delivery.error).toMatch(/switched off|disabled/i);
  });

  it("lets a genuine infrastructure failure in enqueueSync surface, rather than filing it as a routine rejection", async () => {
    // Not `SyncDisabledError` — a plain infrastructure failure (a DB error, a
    // constraint violation) reaching the same catch site must NOT be treated
    // like a verified-but-refused delivery: it has to keep propagating so it
    // surfaces as a 500 that alerts operators, instead of a 404 and a quiet
    // "rejected" delivery row that hides the real problem.
    const brokenJobs: SyncJobsRepository = {
      ensure: async (input): Promise<SyncJob> => ({ id: "job-1", ...input, enabled: true, cursor: null }),
      find: async () => {
        throw new Error("connection to the database was lost");
      },
      listForConnection: async () => [],
      setCursor: async () => {},
      setEnabled: async () => null,
    };
    const deps = makeDeps({ jobs: brokenJobs });
    await connectIntegration(deps)(principal, {
      provider: "wallet",
      credentials: { token: "t", webhookSecret: SECRET },
    });

    await expect(
      handleWebhook(deps)({ provider: "wallet", rawBody: BODY, headers: signature(SECRET) }),
    ).rejects.toThrow("connection to the database was lost");
    // No delivery row either: the transaction this ran in never got to commit
    // one, exactly as an uncaught error inside it should behave.
    expect((deps.deliveries as MemoryWebhookDeliveriesRepository).rows).toEqual([]);
  });
});
