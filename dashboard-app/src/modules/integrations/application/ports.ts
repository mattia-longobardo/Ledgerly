import type { SealedCredential } from "@/platform/integrations/crypto";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  SyncRun,
  SyncRunStatus,
  SyncSchedule,
  SyncTrigger,
} from "@/platform/integrations/types";

export interface NewConnection {
  userId: string;
  provider: ProviderCode;
  status: ConnectionStatus;
  settings: Record<string, unknown>;
  disconnectPolicy: DisconnectPolicy;
}

export type ConnectionPatch = Partial<Pick<IntegrationConnection, "settings" | "disconnectPolicy">>;

export interface ConnectionStatePatch {
  status?: ConnectionStatus;
  lastTestAt?: Date | null;
  lastSyncAt?: Date | null;
  lastError?: string | null;
}

export interface ConnectionsRepository {
  list(userId: string): Promise<IntegrationConnection[]>;
  get(userId: string, id: string): Promise<IntegrationConnection | null>;
  /**
   * By id alone. Only the two paths with no principal use it — the webhook and
   * the queue drain — and both run in the system context, which is why it
   * carries no `userId` to check against.
   */
  getById(id: string): Promise<IntegrationConnection | null>;
  getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null>;
  create(input: NewConnection): Promise<IntegrationConnection>;
  update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null>;
  /**
   * Lifecycle stamps — status, last test, last sync, last error — written by
   * the engine itself. Deliberately not version-checked: a sync finishing must
   * not lose a race with a person editing the connection's settings, and
   * neither write can invalidate the other.
   */
  recordState(id: string, patch: ConnectionStatePatch): Promise<void>;
  delete(userId: string, id: string): Promise<boolean>;
  readCredentials(userId: string, id: string): Promise<SealedCredential | null>;
  writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void>;
  /** Every connected connection for a provider, across users. The webhook resolver's read. */
  candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]>;
}

/**
 * One schedulable unit of sync per (connection, kind) — spec §5.2's
 * `sync_jobs`. It is what makes a kind switchable off without disconnecting the
 * whole provider, and where the cursor lives (Rulings P2-C4, P2-C5).
 */
export interface SyncJob {
  id: string;
  connectionId: string;
  kind: SyncKind;
  schedule: SyncSchedule;
  enabled: boolean;
  cursor: unknown;
}

export interface SyncJobsRepository {
  /** Idempotent: one row per (connection, kind). Called on every connect. */
  ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob>;
  find(connectionId: string, kind: SyncKind): Promise<SyncJob | null>;
  listForConnection(connectionId: string): Promise<SyncJob[]>;
  setCursor(id: string, cursor: unknown): Promise<void>;
}

export interface NewSyncRun {
  connectionId: string;
  jobId: string | null;
  kind: SyncKind;
  trigger: SyncTrigger;
}

export interface SyncRunsRepository {
  /** A run that starts `running` right now. */
  start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun>;
  /** A run that starts `queued`, for somebody else to execute (spec §3.4). */
  enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun>;
  /**
   * Moves a `queued` run to `running`, atomically. Null when it is no longer
   * queued — which is exactly how two ticks racing the same row end up running
   * it once.
   */
  claim(id: string, startedAt: Date): Promise<SyncRun | null>;
  finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void>;
  running(connectionId: string, kind: SyncKind): Promise<SyncRun | null>;
  recent(connectionId: string, limit: number): Promise<SyncRun[]>;
  /** Oldest queued runs first, across every connection. Read in the system context. */
  queued(limit: number): Promise<SyncRun[]>;
}

export interface WebhookDelivery {
  connectionId: string | null;
  provider: ProviderCode;
  event: string;
  payloadHash: string;
  status: "accepted" | "rejected";
  error: string | null;
  receivedAt: Date;
}

export interface WebhookDeliveriesRepository {
  record(input: WebhookDelivery): Promise<void>;
}
