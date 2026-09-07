import { and, asc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import type { DbClient } from "@/lib/db/client";
import {
  providerLinks,
  timeoffEvents,
  timeoffTypes,
  type TimeoffEventRow,
} from "@/lib/db/schema";
import type {
  EventsRepository,
  ProviderEventWrite,
  TimeoffEvent,
} from "../application/ports";

/** R7-3: the Trek entry id lives in `provider_links` under this coordinate. */
const PROVIDER = "trek";
const ENTITY_TYPE = "timeoff_event";

function toEvent(row: TimeoffEventRow, typeCode: string, externalId: string | null): TimeoffEvent {
  return {
    id: row.id,
    userId: row.userId,
    typeId: row.typeId,
    typeCode,
    date: row.date,
    fraction: row.fraction,
    status: row.status,
    origin: row.origin,
    note: row.note,
    pendingOp: row.pendingOp,
    syncedAt: row.syncedAt,
    trekEntryId: externalId === null ? null : Number(externalId),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Postgres-backed events — the replacement for `src/lib/repo/leave.ts`, with
 * the same operations made user-scoped.
 *
 * Two things are worth stating because neither is visible from a call site:
 *
 *  - The Trek entry id is NOT a column. It is joined from `provider_links`
 *    (R7-3), so a write that creates or moves an entry touches two tables and
 *    both writes must happen in the caller's one transaction.
 *  - `stageDelete` keeps the row. A tombstone is the only way the next sync
 *    pass learns that a day the owner removed here still has to be removed
 *    upstream; `clearPending` is what finally deletes it.
 */
export class DrizzleEventsRepository implements EventsRepository {
  constructor(private readonly db: DbClient) {}

  private baseQuery() {
    return this.db
      .select({
        event: timeoffEvents,
        typeCode: timeoffTypes.code,
        externalId: providerLinks.externalId,
      })
      .from(timeoffEvents)
      .innerJoin(timeoffTypes, eq(timeoffTypes.id, timeoffEvents.typeId))
      .leftJoin(
        providerLinks,
        and(
          eq(providerLinks.userId, timeoffEvents.userId),
          eq(providerLinks.provider, PROVIDER),
          eq(providerLinks.entityType, ENTITY_TYPE),
          eq(providerLinks.entityId, timeoffEvents.id),
        ),
      );
  }

  async inRange(userId: string, from: string, to: string): Promise<TimeoffEvent[]> {
    const rows = await this.baseQuery()
      .where(and(
        eq(timeoffEvents.userId, userId),
        gte(timeoffEvents.date, from),
        lte(timeoffEvents.date, to),
      ))
      .orderBy(asc(timeoffEvents.date));
    return rows.map((r) => toEvent(r.event, r.typeCode, r.externalId));
  }

  async at(userId: string, date: string): Promise<TimeoffEvent | null> {
    const [row] = await this.baseQuery()
      .where(and(eq(timeoffEvents.userId, userId), eq(timeoffEvents.date, date)))
      .limit(1);
    return row ? toEvent(row.event, row.typeCode, row.externalId) : null;
  }

  async pending(userId: string): Promise<TimeoffEvent[]> {
    const rows = await this.baseQuery()
      .where(and(eq(timeoffEvents.userId, userId), ne(timeoffEvents.pendingOp, "none")))
      .orderBy(asc(timeoffEvents.date));
    return rows.map((r) => toEvent(r.event, r.typeCode, r.externalId));
  }

  async upsertFromProvider(
    userId: string,
    rows: readonly ProviderEventWrite[],
    now: Date,
  ): Promise<number> {
    for (const row of rows) {
      const [event] = await this.db
        .insert(timeoffEvents)
        .values({
          userId,
          typeId: row.typeId,
          date: row.date,
          fraction: row.fraction,
          origin: PROVIDER,
          note: row.note,
          pendingOp: "none",
          syncedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [timeoffEvents.userId, timeoffEvents.date],
          set: {
            typeId: row.typeId,
            fraction: row.fraction,
            note: row.note,
            origin: PROVIDER,
            pendingOp: "none",
            syncedAt: now,
            version: sql`${timeoffEvents.version} + 1`,
            updatedAt: now,
          },
        })
        .returning({ id: timeoffEvents.id });
      await this.linkTrekEntry(userId, event!.id, row.trekEntryId, now);
    }
    return rows.length;
  }

  /**
   * Writes the `provider_links` row for one event.
   *
   * The stale-link delete is not defensive noise: `provider_links_external_uq`
   * is unique on `(user, provider, entity_type, external_id)`, so if Trek
   * hands the same entry id back for a different day — which it does when an
   * entry is edited rather than recreated — inserting without clearing the old
   * pointer first fails the whole pass.
   */
  private async linkTrekEntry(userId: string, eventId: string, trekEntryId: number, now: Date) {
    const externalId = String(trekEntryId);
    await this.db.delete(providerLinks).where(and(
      eq(providerLinks.userId, userId),
      eq(providerLinks.provider, PROVIDER),
      eq(providerLinks.entityType, ENTITY_TYPE),
      eq(providerLinks.externalId, externalId),
      ne(providerLinks.entityId, eventId),
    ));
    await this.db
      .insert(providerLinks)
      .values({
        userId,
        provider: PROVIDER,
        entityType: ENTITY_TYPE,
        entityId: eventId,
        externalId,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [providerLinks.userId, providerLinks.provider, providerLinks.entityType, providerLinks.entityId],
        set: { externalId, lastSeenAt: now, missingSince: null },
      });
  }

  async deleteDates(userId: string, dates: readonly string[]): Promise<number> {
    if (dates.length === 0) return 0;
    const rows = await this.db
      .delete(timeoffEvents)
      .where(and(eq(timeoffEvents.userId, userId), inArray(timeoffEvents.date, [...dates])))
      .returning({ id: timeoffEvents.id });
    await this.unlink(userId, rows.map((r) => r.id));
    return rows.length;
  }

  private async unlink(userId: string, eventIds: readonly string[]) {
    if (eventIds.length === 0) return;
    await this.db.delete(providerLinks).where(and(
      eq(providerLinks.userId, userId),
      eq(providerLinks.provider, PROVIDER),
      eq(providerLinks.entityType, ENTITY_TYPE),
      inArray(providerLinks.entityId, [...eventIds]),
    ));
  }

  async stageUpsert(
    userId: string,
    input: { date: string; fraction: string; typeId: string; note: string | null },
    now: Date,
  ): Promise<TimeoffEvent> {
    await this.db
      .insert(timeoffEvents)
      .values({
        userId,
        typeId: input.typeId,
        date: input.date,
        fraction: input.fraction,
        origin: "manual",
        note: input.note,
        pendingOp: "upsert",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [timeoffEvents.userId, timeoffEvents.date],
        // `origin` is deliberately absent: a day Trek owns stays Trek's, even
        // once the owner has edited it here. The pending flag carries the edit.
        set: {
          typeId: input.typeId,
          fraction: input.fraction,
          note: input.note,
          status: "planned",
          pendingOp: "upsert",
          version: sql`${timeoffEvents.version} + 1`,
          updatedAt: now,
        },
      });
    const saved = await this.at(userId, input.date);
    if (!saved) throw new Error("timeoff event vanished immediately after its upsert");
    return saved;
  }

  async stageDelete(userId: string, date: string, now: Date): Promise<TimeoffEvent | null> {
    const [row] = await this.db
      .update(timeoffEvents)
      .set({
        pendingOp: "delete",
        version: sql`${timeoffEvents.version} + 1`,
        updatedAt: now,
      })
      .where(and(eq(timeoffEvents.userId, userId), eq(timeoffEvents.date, date)))
      .returning({ id: timeoffEvents.id });
    return row ? this.at(userId, date) : null;
  }

  async clearPending(
    userId: string,
    dates: readonly string[],
    now: Date,
    trekIds?: ReadonlyMap<string, number>,
  ): Promise<number> {
    if (dates.length === 0) return 0;
    const wanted = [...dates];

    // A row that only existed to carry a removal has done its job.
    const removed = await this.db
      .delete(timeoffEvents)
      .where(and(
        eq(timeoffEvents.userId, userId),
        inArray(timeoffEvents.date, wanted),
        eq(timeoffEvents.pendingOp, "delete"),
      ))
      .returning({ id: timeoffEvents.id });
    await this.unlink(userId, removed.map((r) => r.id));

    const settled = await this.db
      .update(timeoffEvents)
      .set({ pendingOp: "none", syncedAt: now, updatedAt: now })
      .where(and(eq(timeoffEvents.userId, userId), inArray(timeoffEvents.date, wanted)))
      .returning({ id: timeoffEvents.id, date: timeoffEvents.date });

    for (const row of settled) {
      const trekEntryId = trekIds?.get(row.date);
      if (trekEntryId !== undefined) await this.linkTrekEntry(userId, row.id, trekEntryId, now);
    }

    return removed.length + settled.length;
  }
}
