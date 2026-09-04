import type { DbClient } from "@/lib/db/client";
import type { AuditInput } from "@/platform/audit/record";
import type { Clock } from "@/platform/clock";
import type { CredentialCipher } from "@/platform/integrations/crypto";
import type { ProviderRegistry } from "@/platform/integrations/types";
import type {
  ConnectionsRepository,
  SyncJobsRepository,
  SyncRunsRepository,
  WebhookDeliveriesRepository,
} from "./ports";

/**
 * Everything an integration use case is allowed to touch.
 *
 * The bag handed to a use case is bound to the **pool**, not to a transaction:
 * a use case opens its own, through `inUserContext`, around the database work
 * and around nothing else. That is what keeps a provider round trip — a
 * connection test, a Wallet page fetch, a Trek MCP conversation — outside every
 * transaction, which is the rule Task 2 established and this phase must not
 * quietly undo.
 */
export interface IntegrationDeps {
  connections: ConnectionsRepository;
  jobs: SyncJobsRepository;
  runs: SyncRunsRepository;
  deliveries: WebhookDeliveriesRepository;
  cipher: CredentialCipher;
  registry: ProviderRegistry;
  /** The client the repositories above are bound to. */
  db: DbClient;
  clock: Clock;
  audit(e: AuditInput): Promise<void>;
  /**
   * Opens a transaction carrying `userId`, and rebuilds this bag inside it, so
   * RLS applies to every statement the callback makes.
   */
  inUserContext<T>(userId: string, fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
  /**
   * The same with `app.role = 'system'`, for the two paths that have no
   * principal at all: verifying an inbound webhook, and draining the sync
   * queue. Neither may be used to write a user's domain data — both hand the
   * work back to `inUserContext` under the connection owner's id.
   */
  inSystemContext<T>(fn: (deps: IntegrationDeps) => Promise<T>): Promise<T>;
}
