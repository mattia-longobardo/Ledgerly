import type { DbClient } from "@/lib/db/client";
import { recordAudit } from "@/platform/audit/record";
import { withSystemContext, withUserContext } from "@/platform/db/context";
import { credentialCipher } from "@/platform/integrations/crypto";
import { providerRegistry } from "@/platform/integrations/registry";
import type { IntegrationDeps } from "../application/deps";
import { DrizzleConnectionsRepository } from "./drizzle-connections-repository";
import { DrizzleSyncJobsRepository } from "./drizzle-sync-jobs-repository";
import { DrizzleSyncRunsRepository } from "./drizzle-sync-runs-repository";
import { DrizzleWebhookDeliveriesRepository } from "./drizzle-webhook-deliveries-repository";

/**
 * The production assembly of `IntegrationDeps` — the mirror of `accountDeps`
 * in the accounts module, and split from `ui/` for the same reason: the API
 * layer must be able to build it without dragging Auth.js (and through it
 * `next/server`) into the import graph.
 *
 * `root` is the CONNECTION POOL, not a transaction. That is the difference
 * from `accountDeps`, and it is deliberate: an integration use case decides
 * for itself where its transactions begin and end, because it also has to talk
 * to a provider over the network and must not do that inside one. `bound` is
 * set only by the two openers below, which rebuild the bag against the
 * transaction they have just opened.
 */
export function integrationDeps(
  root: DbClient,
  requestId?: string | null,
  bound?: DbClient,
): IntegrationDeps {
  const client = bound ?? root;
  return {
    connections: new DrizzleConnectionsRepository(client),
    jobs: new DrizzleSyncJobsRepository(client),
    runs: new DrizzleSyncRunsRepository(client),
    deliveries: new DrizzleWebhookDeliveriesRepository(client),
    cipher: credentialCipher(),
    registry: providerRegistry,
    db: client,
    clock: { now: () => new Date() },
    audit: (e) => recordAudit(client, { ...e, requestId: requestId ?? null }),
    // Always on `root`: nesting a transaction inside `bound` would take a
    // second pool connection while the first is still held, which is how a
    // pool of eight deadlocks under load.
    inUserContext: (userId, fn) =>
      withUserContext(root, { userId }, (tx) => fn(integrationDeps(root, requestId, tx))),
    inSystemContext: (fn) => withSystemContext(root, (tx) => fn(integrationDeps(root, requestId, tx))),
  };
}
