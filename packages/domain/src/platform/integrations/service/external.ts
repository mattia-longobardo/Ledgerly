import { and, asc, eq, inArray } from "drizzle-orm";
import type { Ctx } from "../../context";
import { getDb, type Tx } from "../../db/client";
import { userScoped } from "../../db/scope";
import { entityTypeSchema, type ProviderLink, providerLinkSchema } from "../rules";
import { providerLinks } from "../schema";
import { IntegrationError } from "./connections";
import { isUniqueViolation } from "../../db/errors";

/**
 * Records that a provider's `externalId` stands for a local entity, or that it still does.
 *
 * `first_seen_at` is written once and never rewritten, while `last_seen_at` moves and
 * `missing_since` clears: that is the whole of the idempotency promise, so running the same sync
 * twice produces the same row rather than a second one. The second unique key does the other
 * half — one local entity cannot be claimed by two of a provider's ids — and a caller that tries
 * gets `link_conflict` instead of a raw database error.
 *
 * `tx` makes this the sink of spec §4.2: a module that creates a row and its link writes both
 * inside its own transaction, so the pair either exists or does not. Without it, a process that
 * died between the two commits would leave a row no `resolveExternal` can find, and the next pass
 * would import it a second time — a movement counted twice is wrong money in every total.
 *
 * With `tx`, a `link_conflict` has already aborted the caller's transaction by the time it is
 * thrown: Postgres does not survive a constraint violation mid-transaction. The caller catches it
 * to decide *what to say*, not to carry on writing — every statement of that transaction, its own
 * row included, is gone. Deciding beforehand (`resolveExternal`) is the way to avoid the throw.
 */
export async function linkExternal(
  ctx: Pick<Ctx, "userId">,
  input: ProviderLink,
  now: Date = new Date(),
  tx?: Tx,
): Promise<void> {
  const parsed = providerLinkSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationError("invalid_link");
  const link = parsed.data;
  try {
    await (tx ?? getDb())
      .insert(providerLinks)
      .values(
        userScoped(ctx).stamp({
          provider: link.provider,
          entityType: link.entityType,
          entityId: link.entityId,
          externalId: link.externalId,
          metadata: link.metadata,
          firstSeenAt: now,
          lastSeenAt: now,
        }),
      )
      .onConflictDoUpdate({
        target: [
          providerLinks.userId,
          providerLinks.provider,
          providerLinks.entityType,
          providerLinks.externalId,
        ],
        set: {
          entityId: link.entityId,
          lastSeenAt: now,
          missingSince: null,
          updatedAt: now,
          ...(link.metadata === null ? {} : { metadata: link.metadata }),
        },
      });
  } catch (error) {
    if (isUniqueViolation(error, "provider_links_entity_uq")) {
      throw new IntegrationError("link_conflict");
    }
    throw error;
  }
}

/**
 * The other direction of {@link resolveExternal}: local entities mapped to the provider's own ids
 * (`entity_id` → `external_id`), for a caller that holds a local row and has to name it to the
 * provider — F4's interest posting, which files its Wallet record under the *provider's* id of the
 * category the rule was given (spec §7.6, §9.1).
 *
 * An entity with no link is simply absent from the map: "this local row has no counterpart at the
 * provider" is an answer, never an error, and never a reason to invent one.
 */
export async function externalIdsOf(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  entityIds: readonly string[],
): Promise<Map<string, string>> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ entityId: providerLinks.entityId, externalId: providerLinks.externalId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .orderBy(asc(providerLinks.entityId), asc(providerLinks.externalId));
  // One local entity holds at most one link per provider and type (`provider_links_entity_uq`),
  // so the first row per entity is the only row; the order makes even a violated key deterministic.
  const found = new Map<string, string>();
  for (const row of rows) if (!found.has(row.entityId)) found.set(row.entityId, row.externalId);
  return found;
}

/** A provider's own ids, mapped to the local entities they stand for (`external_id` → `entity_id`). */
export async function resolveExternal(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  externalIds: string[],
): Promise<Map<string, string>> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(externalIds)];
  if (wanted.length === 0) return new Map();
  const rows = await getDb()
    .select({ externalId: providerLinks.externalId, entityId: providerLinks.entityId })
    .from(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.externalId, wanted),
      ),
    )
    .orderBy(asc(providerLinks.externalId));
  return new Map(rows.map((row) => [row.externalId, row.entityId]));
}

/**
 * Forgets the links of entities that no longer exist here. Called by the module that owns them:
 * a deleted local row must not leave a link behind holding its half of the entity unique key,
 * claiming a `first_seen_at` for a row nothing can resolve any more (`entity_id` is not a real
 * foreign key — the deviation of §11.4 — so no cascade does this for us).
 *
 * `missing_since` is written by nobody. The disappearance of §7.2 is decided and applied in the
 * transactions module, from the re-read window, and a second copy of that rule here would be a
 * second source of truth (§4.3). The column stays because §4.3 fixes the shape of this table and
 * changing it would take a second migration; {@link linkExternal} only ever clears it.
 */
export async function unlinkEntities(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  entityType: string,
  entityIds: string[],
  tx?: Tx,
): Promise<number> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return 0;
  const deleted = await (tx ?? getDb())
    .delete(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.provider, provider),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .returning({ id: providerLinks.id });
  return deleted.length;
}

/**
 * {@link unlinkEntities} for every provider at once: what a deleted account took with it may have
 * come from more than one source (an account switched from one to another keeps the links of both).
 */
export async function unlinkEntitiesOfEveryProvider(
  ctx: Pick<Ctx, "userId">,
  entityType: string,
  entityIds: string[],
): Promise<number> {
  const type = entityTypeSchema.safeParse(entityType);
  if (!type.success) throw new IntegrationError("invalid_link");
  const wanted = [...new Set(entityIds)];
  if (wanted.length === 0) return 0;
  const deleted = await getDb()
    .delete(providerLinks)
    .where(
      and(
        userScoped(ctx).owns(providerLinks),
        eq(providerLinks.entityType, type.data),
        inArray(providerLinks.entityId, wanted),
      ),
    )
    .returning({ id: providerLinks.id });
  return deleted.length;
}
