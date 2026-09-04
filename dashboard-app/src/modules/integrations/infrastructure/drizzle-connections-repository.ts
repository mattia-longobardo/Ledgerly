import { and, eq } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { integrationConnections, type IntegrationConnectionRow } from "@/lib/db/schema";
import type { SealedCredential } from "@/platform/integrations/crypto";
import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  ProviderCode,
} from "@/platform/integrations/types";
import type {
  ConnectionPatch,
  ConnectionStatePatch,
  ConnectionsRepository,
  NewConnection,
} from "../application/ports";

function toConnection(row: IntegrationConnectionRow): IntegrationConnection {
  return {
    id: row.id,
    userId: row.userId,
    provider: row.provider as ProviderCode,
    status: row.status as ConnectionStatus,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    lastTestAt: row.lastTestAt,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    disconnectPolicy: row.disconnectPolicy as DisconnectPolicy,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed connections. Expects a client already inside
 * `withUserContext`, so RLS scopes every statement on top of the explicit
 * `user_id` predicates below.
 *
 * The credential columns are never selected by the read methods: a connection
 * object handed to a use case, a route or a template can therefore never carry
 * a secret, because the shape has no field for one.
 */
export class DrizzleConnectionsRepository implements ConnectionsRepository {
  constructor(private readonly db: DbClient) {}

  async list(userId: string): Promise<IntegrationConnection[]> {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.userId, userId));
    return rows.map(toConnection).sort((a, b) => a.provider.localeCompare(b.provider));
  }

  async get(userId: string, id: string): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .limit(1);
    return row ? toConnection(row) : null;
  }

  /**
   * By id alone, with no user predicate: the webhook resolver and the sync
   * queue drain have no principal to check against, and both call this inside
   * `inSystemContext`. Every other read carries the user id.
   */
  async getById(id: string): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id))
      .limit(1);
    return row ? toConnection(row) : null;
  }

  async getByProvider(userId: string, provider: ProviderCode): Promise<IntegrationConnection | null> {
    const [row] = await this.db
      .select()
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.provider, provider)))
      .limit(1);
    return row ? toConnection(row) : null;
  }

  async create(input: NewConnection): Promise<IntegrationConnection> {
    const [row] = await this.db
      .insert(integrationConnections)
      .values({
        userId: input.userId,
        provider: input.provider,
        status: input.status,
        settings: input.settings,
        disconnectPolicy: input.disconnectPolicy,
      })
      .returning();
    return toConnection(row!);
  }

  async update(
    userId: string,
    id: string,
    expectedVersion: number,
    patch: ConnectionPatch,
  ): Promise<IntegrationConnection | "version_mismatch" | null> {
    const [row] = await this.db
      .update(integrationConnections)
      .set({
        ...(patch.settings !== undefined ? { settings: patch.settings } : {}),
        ...(patch.disconnectPolicy !== undefined ? { disconnectPolicy: patch.disconnectPolicy } : {}),
        version: expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(integrationConnections.userId, userId),
          eq(integrationConnections.id, id),
          eq(integrationConnections.version, expectedVersion),
        ),
      )
      .returning();
    if (row) return toConnection(row);
    return (await this.get(userId, id)) === null ? null : "version_mismatch";
  }

  async recordState(id: string, patch: ConnectionStatePatch): Promise<void> {
    await this.db
      .update(integrationConnections)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(integrationConnections.id, id));
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .returning({ id: integrationConnections.id });
    return rows.length > 0;
  }

  async readCredentials(userId: string, id: string): Promise<SealedCredential | null> {
    const [row] = await this.db
      .select({
        ciphertext: integrationConnections.credentialsCiphertext,
        keyId: integrationConnections.keyId,
      })
      .from(integrationConnections)
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)))
      .limit(1);
    if (!row || !row.ciphertext || !row.keyId) return null;
    return { keyId: row.keyId, ciphertext: row.ciphertext };
  }

  async writeCredentials(userId: string, id: string, sealed: SealedCredential | null): Promise<void> {
    await this.db
      .update(integrationConnections)
      .set({
        credentialsCiphertext: sealed?.ciphertext ?? null,
        keyId: sealed?.keyId ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(integrationConnections.userId, userId), eq(integrationConnections.id, id)));
  }

  /** No principal exists when a webhook arrives, so the caller runs this in the system context. */
  async candidatesForWebhook(provider: ProviderCode): Promise<IntegrationConnection[]> {
    const rows = await this.db
      .select()
      .from(integrationConnections)
      .where(
        and(eq(integrationConnections.provider, provider), eq(integrationConnections.status, "connected")),
      );
    return rows.map(toConnection);
  }
}
