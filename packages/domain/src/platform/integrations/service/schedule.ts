import { and, asc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import type { Ctx } from "../../context";
import { getDb } from "../../db/client";
import { civilDateIn } from "../../../shared/dates";
import { userScoped } from "../../db/scope";
import { type SyncKind } from "../rules";
import {
  nextSyncAfterPass,
  nextSyncAt,
  parseSyncSchedule,
  scheduleProblems,
  type SyncSchedule,
  syncScheduleSchema,
} from "../schedule";
import { users } from "../../auth/schema";
import { integrationConnections } from "../schema";
import {
  CONNECTION_COLUMNS,
  IntegrationError,
  listConnections,
  toConnection,
  type Connection,
} from "./connections";

/* The schedule of a connection (docs/scheduler.md) */

/**
 * Saves when a connection syncs and works out its next pass in the person's zone. The schedule
 * comes from a form, so it is parsed here and refused as `invalid_schedule` when it is not a list
 * of valid rules, when a rule never runs, when two passes would come closer than the minimum
 * gap, or when a day has more than `maxPerDay` passes (a bank's connection: the caller knows the
 * provider); "Sync now" never goes through here and never moves `next_sync_at`.
 */
export async function saveSchedule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connectionId: string,
  input: unknown,
  { now = new Date(), maxPerDay }: { now?: Date; maxPerDay?: number } = {},
): Promise<Connection> {
  const parsed = syncScheduleSchema.safeParse(input);
  if (!parsed.success) throw new IntegrationError("invalid_schedule");
  const problems = scheduleProblems(parsed.data, civilDateIn(now, ctx.timeZone), maxPerDay);
  if (problems.length > 0) throw new IntegrationError("invalid_schedule", problems);
  const [row] = await getDb()
    .update(integrationConnections)
    .set({ schedule: parsed.data, nextSyncAt: nextSyncAt(parsed.data, ctx.timeZone, now), updatedAt: now })
    .where(and(eq(integrationConnections.id, connectionId), userScoped(ctx).owns(integrationConnections)))
    .returning(CONNECTION_COLUMNS);
  if (!row) throw new IntegrationError("not_found");
  return toConnection(row);
}

/**
 * Moves a connection's next pass on after the dispatcher has made one (or has tried to) for the
 * slot `connection.nextSyncAt`: the first slot after `now`, never closer than the minimum gap.
 */
export async function advanceSchedule(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  connection: Pick<Connection, "id" | "schedule" | "nextSyncAt">,
  now: Date = new Date(),
): Promise<Date | null> {
  const next = nextSyncAfterPass(connection.schedule, ctx.timeZone, connection.nextSyncAt, now);
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: next })
    .where(and(eq(integrationConnections.id, connection.id), userScoped(ctx).owns(integrationConnections)));
  return next;
}

/**
 * Recomputes every connection's next pass of one person, for when their time zone changed: the
 * times of a schedule are local times, so "07:00" has to follow the person to their new zone.
 */
export async function rescheduleConnections(
  ctx: Pick<Ctx, "userId" | "timeZone">,
  now: Date = new Date(),
): Promise<number> {
  const connections = await listConnections(ctx);
  for (const connection of connections) {
    await getDb()
      .update(integrationConnections)
      .set({ nextSyncAt: nextSyncAt(connection.schedule, ctx.timeZone, now) })
      .where(and(eq(integrationConnections.id, connection.id), userScoped(ctx).owns(integrationConnections)));
  }
  return connections.length;
}

/**
 * Makes every scheduled connection of the person with one provider due now: the next tick of the
 * dispatcher reads them. For a provider the person has just turned on again (decision H30).
 */
export async function makeDueNow(
  ctx: Pick<Ctx, "userId">,
  provider: string,
  now: Date = new Date(),
): Promise<void> {
  await getDb()
    .update(integrationConnections)
    .set({ nextSyncAt: now })
    .where(
      and(
        userScoped(ctx).owns(integrationConnections),
        eq(integrationConnections.provider, provider),
        sql`${integrationConnections.nextSyncAt} is not null`,
      ),
    );
}

/** A connection the dispatcher owes a pass: whose, which provider, on what schedule, since when. */
export interface DueConnection {
  id: string;
  userId: string;
  provider: string;
  schedule: SyncSchedule;
  nextSyncAt: Date | null;
}

/** Which connections the dispatcher may pass: not revoked, and not of a banned person. */
function dueWhere(now: Date) {
  return and(
    lte(integrationConnections.nextSyncAt, now),
    ne(integrationConnections.state, "revoked"),
    or(isNull(users.banned), eq(users.banned, false)),
  );
}

/**
 * Every connection whose next pass is due, across all users, oldest debt first. An `error`
 * connection is included, because it must keep being retried. A `revoked` one is not, nor any
 * connection of a banned person (PERS-49 SEC-08): a refused token waits for a new one, and a
 * blocked account makes no outbound call. "Sync now" and a new token still reach them.
 */
export async function dueConnections(now: Date = new Date()): Promise<DueConnection[]> {
  const rows = await getDb()
    .select({
      id: integrationConnections.id,
      userId: integrationConnections.userId,
      provider: integrationConnections.provider,
      schedule: integrationConnections.schedule,
      nextSyncAt: integrationConnections.nextSyncAt,
    })
    .from(integrationConnections)
    .innerJoin(users, eq(users.id, integrationConnections.userId))
    .where(dueWhere(now))
    .orderBy(asc(integrationConnections.nextSyncAt), asc(integrationConnections.id));
  return rows.map((row) => ({ ...row, schedule: parseSyncSchedule(row.schedule) }));
}

/**
 * Whether any connection is due: the minute tick asks this first, so a minute with nothing to do
 * writes no `job_runs` row (one index probe on `next_sync_at`).
 */
export async function anyConnectionDue(now: Date = new Date()): Promise<boolean> {
  const rows = await getDb()
    .select({ id: integrationConnections.id })
    .from(integrationConnections)
    .innerJoin(users, eq(users.id, integrationConnections.userId))
    .where(dueWhere(now))
    .limit(1);
  return rows.length > 0;
}

/**
 * The keys of a cursor that are the person's settings rather than where a reading stands: they
 * outlive "Disconnect" (H55, point 4). How deep the history goes (`BACKFILL_MONTHS` of
 * `movements/depth.ts` of plugin-host, a string here so the core imports no source) is the only one.
 */
export const SETTING_KEYS: Partial<Record<SyncKind, readonly string[]>> = {
  transactions: ["backfillMonths"],
};
