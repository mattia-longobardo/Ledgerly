import { and, eq, inArray, isNull, like, lt, notInArray, sql } from "drizzle-orm";
import { NOTIFICATION_EVENTS, type NotificationEvent, type NotificationParams } from "@ledgerly/api-contract";
import { addonOn, type Ctx } from "../context";
import { getDb } from "../db/client";
import { notificationPreferences, notifications } from "./schema";

/** A fact a module has seen (R5e): the event, what it is about, and what a client needs to say it. */
export interface Fact {
  event: NotificationEvent;
  /** The fact within its event: one open row per subject. */
  subject: string;
  params?: NotificationParams;
  /** The connection, account, budget or fund the client opens. */
  targetId?: string | null;
}

interface Channels {
  inApp: boolean;
  email: boolean;
  device: boolean;
}

/** The events that sent an email before R5e: their email stays on, so nobody gets fewer mails. */
const MAILED_BEFORE_R5E: ReadonlySet<NotificationEvent> = new Set([
  "connection_failed",
  "connection_stale",
  "connection_expiring",
  "account_low_balance",
  "budget_threshold",
  "monthly_summary",
]);

/**
 * The channels of an event nobody has chosen for: what Ledgerly did before R5e, plus the device
 * for the events that ask for an action (D4 A). The email of the monthly summary is also gated by
 * the person's own `monthly_summary` preference, which the job reads.
 */
export function defaultChannels(event: NotificationEvent): Channels {
  return {
    inApp: true,
    email: MAILED_BEFORE_R5E.has(event),
    device: NOTIFICATION_EVENTS[event].category === "action",
  };
}

/** The channels of one event for the person: their choice, or the default. */
export async function channelsOf(ctx: Pick<Ctx, "userId">, event: NotificationEvent): Promise<Channels> {
  const [row] = await getDb()
    .select({
      inApp: notificationPreferences.inApp,
      email: notificationPreferences.email,
      device: notificationPreferences.device,
    })
    .from(notificationPreferences)
    .where(and(eq(notificationPreferences.userId, ctx.userId), eq(notificationPreferences.event, event)));
  return row ?? defaultChannels(event);
}

/** Whether the event can be told to the person at all: not while its addon is off (PA10). */
function eventActive(ctx: Pick<Ctx, "addons">, event: NotificationEvent): boolean {
  const { addon } = NOTIFICATION_EVENTS[event];
  return addon === null || addonOn(ctx, addon);
}

/**
 * Opens the fact, or keeps the open one: a fact has at most one open row, so raising it again only
 * moves `last_raised_at` and refreshes its parameters. Returns false, and writes nothing, for an
 * event whose addon is off.
 */
export async function raise(
  ctx: Pick<Ctx, "userId" | "addons">,
  fact: Fact,
  now: Date = new Date(),
): Promise<boolean> {
  if (!eventActive(ctx, fact.event)) return false;
  const params = fact.params ?? {};
  const targetId = fact.targetId ?? null;
  await getDb()
    .insert(notifications)
    .values({
      userId: ctx.userId,
      event: fact.event,
      subject: fact.subject,
      params,
      targetId,
      openedAt: now,
      lastRaisedAt: now,
    })
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.event, notifications.subject],
      targetWhere: isNull(notifications.resolvedAt),
      set: { lastRaisedAt: now, params, targetId },
    });
  return true;
}

/**
 * Which open facts of an event to close: one subject, the subjects that start with a prefix (every
 * threshold of one connection's end), or every subject but the ones still true.
 */
type Match = { subject: string } | { prefix: string; except?: string } | { keep: readonly string[] };

/** Closes the open facts of an event that are no longer true. */
export async function resolve(
  ctx: Pick<Ctx, "userId">,
  event: NotificationEvent,
  match: Match,
  now: Date = new Date(),
): Promise<number> {
  const which =
    "subject" in match
      ? eq(notifications.subject, match.subject)
      : "prefix" in match
        ? and(
            like(notifications.subject, `${match.prefix.replace(/[\\%_]/g, "\\$&")}%`),
            match.except === undefined ? undefined : sql`${notifications.subject} <> ${match.except}`,
          )
        : match.keep.length === 0
          ? undefined
          : notInArray(notifications.subject, [...match.keep]);
  const rows = await getDb()
    .update(notifications)
    .set({ resolvedAt: now })
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        eq(notifications.event, event),
        isNull(notifications.resolvedAt),
        which,
      ),
    )
    .returning({ id: notifications.id });
  return rows.length;
}

/** The open facts of the person, for the events given: what a test or a read of R5e looks at. */
export async function openFacts(ctx: Pick<Ctx, "userId">, events: readonly NotificationEvent[]) {
  return getDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        inArray(notifications.event, [...events]),
        isNull(notifications.resolvedAt),
      ),
    )
    .orderBy(notifications.openedAt, notifications.id);
}

/**
 * Drops the rows past the retention window: a closed fact by the time it closed, an open one by the
 * last time it was raised (a monthly summary is raised once).
 */
export async function deleteOldFacts(cutoff: Date): Promise<number> {
  const rows = await getDb()
    .delete(notifications)
    .where(lt(sql`coalesce(${notifications.resolvedAt}, ${notifications.lastRaisedAt})`, cutoff))
    .returning({ id: notifications.id });
  return rows.length;
}
