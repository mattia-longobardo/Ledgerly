import { randomUUID } from "node:crypto";
import type { SealedCredential, CredentialCipher } from "@/platform/integrations/crypto";
import type {
  IntegrationConnection,
  ProviderCode,
  SyncKind,
  SyncRun,
  SyncRunStatus,
  SyncSchedule,
} from "@/platform/integrations/types";
import type {
  ConnectionPatch,
  ConnectionStatePatch,
  ConnectionsRepository,
  NewConnection,
  NewSyncRun,
  SyncJob,
  SyncJobsRepository,
  SyncRunsRepository,
  WebhookDeliveriesRepository,
  WebhookDelivery,
} from "../application/ports";

interface Stored {
  connection: IntegrationConnection;
  sealed: SealedCredential | null;
}

export class MemoryConnectionsRepository implements ConnectionsRepository {
  private rows: Stored[] = [];

  private find(userId: string, id: string): Stored | undefined {
    return this.rows.find((r) => r.connection.userId === userId && r.connection.id === id);
  }

  async list(userId: string): Promise<IntegrationConnection[]> {
    return this.rows
      .filter((r) => r.connection.userId === userId)
      .map((r) => r.connection)
      .sort((a, b) => a.provider.localeCompare(b.provider));
  }

  async get(userId: string, id: string): Promise<IntegrationConnection | null> {
    return this.find(userId, id)?.connection ?? null;
  }

  async getById(id: string): Promise<IntegrationConnection | null> {
    return this.rows.find((r) => r.connection.id === id)?.connection ?? null;
  }

  async getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null> {
    return (
      this.rows.find((r) => r.connection.userId === userId && r.connection.provider === provider)?.connection ??
      null
    );
  }

  async create(input: NewConnection): Promise<IntegrationConnection> {
    const now = new Date();
    const connection: IntegrationConnection = {
      ...input,
      id: randomUUID(),
      lastTestAt: null,
      lastSyncAt: null,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push({ connection, sealed: null });
    return connection;
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null> {
    const row = this.find(userId, id);
    if (!row) return null;
    if (row.connection.version !== expectedVersion) return "version_mismatch";
    row.connection = {
      ...row.connection,
      ...patch,
      version: row.connection.version + 1,
      updatedAt: new Date(),
    };
    return row.connection;
  }

  async recordState(id: string, patch: ConnectionStatePatch): Promise<void> {
    const row = this.rows.find((r) => r.connection.id === id);
    if (!row) return;
    row.connection = { ...row.connection, ...patch, updatedAt: new Date() };
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const index = this.rows.findIndex((r) => r.connection.userId === userId && r.connection.id === id);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }

  async readCredentials(userId: string, id: string): Promise<SealedCredential | null> {
    return this.find(userId, id)?.sealed ?? null;
  }

  async writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void> {
    const row = this.find(userId, id);
    if (row) row.sealed = sealed;
  }

  async candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]> {
    return this.rows
      .filter((r) => r.connection.provider === provider && r.connection.status === "connected")
      .map((r) => r.connection);
  }
}

export class MemorySyncJobsRepository implements SyncJobsRepository {
  private rows: SyncJob[] = [];

  async ensure(input: { connectionId: string; kind: SyncKind; schedule: SyncSchedule }): Promise<SyncJob> {
    const existing = this.rows.find((r) => r.connectionId === input.connectionId && r.kind === input.kind);
    if (existing) return existing;
    const job: SyncJob = { id: randomUUID(), ...input, enabled: true, cursor: null };
    this.rows.push(job);
    return job;
  }

  async find(connectionId: string, kind: SyncKind): Promise<SyncJob | null> {
    return this.rows.find((r) => r.connectionId === connectionId && r.kind === kind) ?? null;
  }

  async listForConnection(connectionId: string): Promise<SyncJob[]> {
    return this.rows.filter((r) => r.connectionId === connectionId);
  }

  async setCursor(id: string, cursor: unknown): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index !== -1) this.rows[index] = { ...this.rows[index]!, cursor };
  }
}

export class MemorySyncRunsRepository implements SyncRunsRepository {
  private rows: SyncRun[] = [];

  private add(input: NewSyncRun, status: "running" | "queued", at: Date): SyncRun {
    const run: SyncRun = {
      id: randomUUID(),
      connectionId: input.connectionId,
      jobId: input.jobId,
      kind: input.kind,
      status,
      trigger: input.trigger,
      stats: {},
      error: null,
      startedAt: at,
      finishedAt: null,
    };
    this.rows.unshift(run);
    return run;
  }

  async start(input: NewSyncRun & { startedAt: Date }): Promise<SyncRun> {
    return this.add(input, "running", input.startedAt);
  }

  async enqueue(input: NewSyncRun & { queuedAt: Date }): Promise<SyncRun> {
    return this.add(input, "queued", input.queuedAt);
  }

  /** Conditional on purpose: the second claimant of the same row gets null, not a second run. */
  async claim(id: string, startedAt: Date): Promise<SyncRun | null> {
    const index = this.rows.findIndex((r) => r.id === id && r.status === "queued");
    if (index === -1) return null;
    const claimed: SyncRun = { ...this.rows[index]!, status: "running", startedAt };
    this.rows[index] = claimed;
    return claimed;
  }

  async finish(
    id: string,
    patch: { status: SyncRunStatus; stats: Record<string, number>; error: string | null; finishedAt: Date },
  ): Promise<void> {
    const index = this.rows.findIndex((r) => r.id === id);
    if (index === -1) return;
    this.rows[index] = { ...this.rows[index]!, ...patch };
  }

  async running(connectionId: string, kind: SyncKind): Promise<SyncRun | null> {
    return (
      this.rows.find((r) => r.connectionId === connectionId && r.kind === kind && r.status === "running") ?? null
    );
  }

  async recent(connectionId: string, limit: number): Promise<SyncRun[]> {
    return this.rows.filter((r) => r.connectionId === connectionId).slice(0, limit);
  }

  async queued(limit: number): Promise<SyncRun[]> {
    return this.rows
      .filter((r) => r.status === "queued")
      .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
      .slice(0, limit);
  }
}

export class MemoryWebhookDeliveriesRepository implements WebhookDeliveriesRepository {
  readonly rows: WebhookDelivery[] = [];

  async record(input: WebhookDelivery): Promise<void> {
    this.rows.push(input);
  }
}

/**
 * A reversible stand-in for the real cipher. Deliberately NOT encryption: it
 * keeps the tests free of `APP_ENCRYPTION_KEY` while still forcing every use
 * case through seal/open, so nothing can accidentally store a plaintext
 * credential and pass.
 */
export function memoryCipher(): CredentialCipher {
  return {
    activeKeyId: "memory",
    seal: (plaintext) => ({
      keyId: "memory",
      ciphertext: Buffer.from(JSON.stringify(plaintext), "utf8"),
    }),
    open: (sealed) => JSON.parse(sealed.ciphertext.toString("utf8")) as Record<string, string>,
  };
}
