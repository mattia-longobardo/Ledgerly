import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { DbClient } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import type { IntegrationDeps } from "@/modules/integrations/application/deps";
import {
  MemoryConnectionsRepository,
  MemorySyncJobsRepository,
  MemorySyncRunsRepository,
  MemoryWebhookDeliveriesRepository,
  memoryCipher,
} from "@/modules/integrations/infrastructure/memory-repositories";
import type { ProviderRegistry } from "@/platform/integrations/types";

/**
 * A real, correctly typed `DbClient` that is not connected to anything.
 *
 * `db: {} as never` was the alternative, and it is worse in both directions: it
 * type-checks a value that has none of the shape, and a test that accidentally
 * touched it would die on `undefined is not a function` rather than saying what
 * happened. This one is a genuine Drizzle client over a pool pointed at a port
 * nothing listens on — constructing it opens no socket, and a test that does
 * reach for the database fails loudly with a connection error naming this host.
 * Every use case in this module is expected to run entirely on the memory
 * repositories.
 */
export const unusedDb: DbClient = drizzle(
  new Pool({ connectionString: "postgresql://unused:unused@127.0.0.1:1/unused", max: 1 }),
  { schema },
);

const EMPTY_REGISTRY: ProviderRegistry = { get: () => null, list: () => [] };

/**
 * `IntegrationDeps` on the memory repositories. Pass `registry` (and anything
 * else) to override.
 *
 * The memory repositories have no transactions, so both context openers hand
 * back the very same bag — which is also what makes a use case's
 * `deps.inUserContext(...)` a no-op wrapper in a unit test rather than
 * something the test has to fake.
 */
export function testIntegrationDeps(over: Partial<IntegrationDeps> = {}): IntegrationDeps {
  const deps: IntegrationDeps = {
    connections: over.connections ?? new MemoryConnectionsRepository(),
    jobs: over.jobs ?? new MemorySyncJobsRepository(),
    runs: over.runs ?? new MemorySyncRunsRepository(),
    deliveries: over.deliveries ?? new MemoryWebhookDeliveriesRepository(),
    cipher: over.cipher ?? memoryCipher(),
    registry: over.registry ?? EMPTY_REGISTRY,
    db: over.db ?? unusedDb,
    clock: over.clock ?? { now: () => new Date("2026-09-04T09:00:00Z") },
    audit: over.audit ?? (async () => {}),
    inUserContext: over.inUserContext ?? ((_userId, fn) => fn(deps)),
    inSystemContext: over.inSystemContext ?? ((fn) => fn(deps)),
  };
  return deps;
}
