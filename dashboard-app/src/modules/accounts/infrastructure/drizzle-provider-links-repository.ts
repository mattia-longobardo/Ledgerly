import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import { providerLinks, type ProviderLinkRow } from "@/lib/db/schema";
import type { ProviderLink, ProviderLinkEntityType, ProviderLinksRepository } from "../application/ports";

function toLink(row: ProviderLinkRow): ProviderLink {
  return {
    provider: row.provider,
    entityType: row.entityType as ProviderLinkEntityType,
    entityId: row.entityId,
    externalId: row.externalId,
    metadata: row.metadata as Record<string, unknown>,
    missingSince: row.missingSince,
  };
}

/**
 * Postgres-backed provider links. Like the accounts repository, it expects a
 * client already inside `withUserContext`, so RLS scopes every statement to
 * the caller on top of the explicit predicates below.
 */
export class DrizzleProviderLinksRepository implements ProviderLinksRepository {
  constructor(private readonly db: DbClient) {}

  async byExternal(
    userId: string,
    provider: string,
    entityType: ProviderLinkEntityType,
    externalIds: string[],
  ): Promise<Map<string, ProviderLink>> {
    if (externalIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(providerLinks)
      .where(
        and(
          eq(providerLinks.userId, userId),
          eq(providerLinks.provider, provider),
          eq(providerLinks.entityType, entityType),
          inArray(providerLinks.externalId, externalIds),
        ),
      );
    return new Map(rows.map((r) => [r.externalId, toLink(r)]));
  }

  async liveFor(entityType: ProviderLinkEntityType, entityId: string): Promise<ProviderLink | null> {
    const [row] = await this.db
      .select()
      .from(providerLinks)
      .where(
        and(
          eq(providerLinks.entityType, entityType),
          eq(providerLinks.entityId, entityId),
          isNull(providerLinks.missingSince),
        ),
      )
      .limit(1);
    return row ? toLink(row) : null;
  }

  async upsertSeen(userId: string, link: Omit<ProviderLink, "missingSince">, seenAt: Date): Promise<void> {
    await this.db
      .insert(providerLinks)
      .values({
        userId,
        provider: link.provider,
        entityType: link.entityType,
        entityId: link.entityId,
        externalId: link.externalId,
        metadata: link.metadata,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt,
      })
      .onConflictDoUpdate({
        target: [
          providerLinks.userId,
          providerLinks.provider,
          providerLinks.entityType,
          providerLinks.externalId,
        ],
        // Seeing the entity again revives it: first_seen_at stays as it was.
        set: {
          entityId: sql`excluded.entity_id`,
          metadata: sql`excluded.metadata`,
          lastSeenAt: seenAt,
          missingSince: null,
        },
      });
  }

  async markMissing(
    userId: string,
    provider: string,
    entityType: ProviderLinkEntityType,
    seenExternalIds: string[],
    at: Date,
  ): Promise<string[]> {
    const conditions = [
      eq(providerLinks.userId, userId),
      eq(providerLinks.provider, provider),
      eq(providerLinks.entityType, entityType),
      isNull(providerLinks.missingSince),
    ];
    // An empty seen list means everything is missing; `notInArray` of nothing would match nothing.
    if (seenExternalIds.length > 0) conditions.push(notInArray(providerLinks.externalId, seenExternalIds));
    const rows = await this.db
      .update(providerLinks)
      .set({ missingSince: at })
      .where(and(...conditions))
      .returning({ entityId: providerLinks.entityId });
    return rows.map((r) => r.entityId);
  }
}
