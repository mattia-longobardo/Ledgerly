// What a client reads of the facts (rewrite plan R5e): «Da fare», the apps' periodic check, the read
// state and the channels of each event. An event of an addon that is off is in none of them (PA10).
import { and, asc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import {
  NOTIFICATION_EVENT_NAMES,
  NOTIFICATION_EVENTS,
  type NotificationEvent,
} from "@ledgerly/api-contract";
import type { Ctx } from "../context";
import { getDb } from "../db/client";
import { notificationPreferences, notifications } from "./schema";
import { type Channels, defaultChannels, eventActive, type Fact, raise, resolve } from "./service";

/** A choice the rules refuse: a locked channel turned off, or an event of an addon that is off. */
export class NotificationError extends Error {
  constructor(readonly code: "invalid" | "module_inactive" | "not_found") {
    super(code);
    this.name = "NotificationError";
  }
}

/** Without a cursor the apps' check starts from the open facts of the last 7 days. */
const FIRST_CHECK_DAYS = 7;
const DEFAULT_FEED_LIMIT = 50;

type Row = typeof notifications.$inferSelect;

const targetOf = (row: Row) => ({ page: NOTIFICATION_EVENTS[row.event].page, id: row.targetId });

/** The events that have no email in R5e: they are told in the app and on the device (D5). */
const WITHOUT_EMAIL: ReadonlySet<NotificationEvent> = new Set([
  "transactions_to_categorize",
  "payslips_to_review",
  "transfers_to_confirm",
  "fund_to_verify",
  "plan_run_to_confirm",
  "plan_run_no_cash",
  "plan_run_price_missing",
  "plan_amount_missing",
]);

/**
 * The channels a person cannot change: the app of an event that asks for an action (always on,
 * so «Da fare» is whole), and the email of an event that has none (always off).
 */
function lockedOf(event: NotificationEvent): ("inApp" | "email" | "device")[] {
  return [
    ...(NOTIFICATION_EVENTS[event].category === "action" ? (["inApp"] as const) : []),
    ...(WITHOUT_EMAIL.has(event) ? (["email"] as const) : []),
  ];
}

async function choicesOf(ctx: Pick<Ctx, "userId">): Promise<Map<NotificationEvent, Channels>> {
  const rows = await getDb()
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, ctx.userId));
  return new Map(rows.map((row) => [row.event, { inApp: row.inApp, email: row.email, device: row.device }]));
}

/**
 * The facts of one event that are true now, as a module reads them: each is raised, and every other
 * open fact of the event is closed. Nothing for an event of an addon that is off (PA10): its facts
 * wait, hidden, for the addon to come back.
 */
export async function syncFacts(
  ctx: Pick<Ctx, "userId" | "addons">,
  event: NotificationEvent,
  read: () => Promise<readonly Omit<Fact, "event">[]>,
  now: Date = new Date(),
): Promise<void> {
  if (!eventActive(ctx, event)) return;
  const facts = await read();
  for (const fact of facts) await raise(ctx, { ...fact, event }, now);
  await resolve(ctx, event, { keep: facts.map((fact) => fact.subject) }, now);
}

/** «Da fare»: the open facts that ask for an action, oldest first. */
export async function todoOf(ctx: Pick<Ctx, "userId" | "addons">) {
  const events = NOTIFICATION_EVENT_NAMES.filter(
    (event) => NOTIFICATION_EVENTS[event].category === "action" && eventActive(ctx, event),
  );
  const rows = await getDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        isNull(notifications.resolvedAt),
        inArray(notifications.event, events),
      ),
    )
    .orderBy(asc(notifications.openedAt), asc(notifications.id));
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    addon: NOTIFICATION_EVENTS[row.event].addon,
    params: row.params,
    target: targetOf(row),
    since: row.openedAt.toISOString(),
  }));
}

/** A cursor of the apps' check: the instant of the last notification seen, and its id. */
function parseCursor(cursor: string): { at: Date; id: string | null } | null {
  const [instant, id, ...rest] = cursor.split("_");
  const seen = new Date(instant);
  if (rest.length > 0 || Number.isNaN(seen.getTime())) return null;
  if (id !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id))
    return null;
  return { at: seen, id: id ?? null };
}

/**
 * The open notifications for the device newer than the cursor, oldest first: the read of the apps'
 * periodic check (G4). Only the events whose device channel is on. `NotificationError("invalid")`
 * for a cursor this read never gave.
 */
export async function deviceFeed(
  ctx: Pick<Ctx, "userId" | "addons">,
  options: { since?: string; limit?: number },
  now: Date = new Date(),
) {
  const cursor = options.since === undefined ? null : parseCursor(options.since);
  if (options.since !== undefined && cursor === null) throw new NotificationError("invalid");
  const choices = await choicesOf(ctx);
  const events = NOTIFICATION_EVENT_NAMES.filter(
    (event) => eventActive(ctx, event) && (choices.get(event) ?? defaultChannels(event)).device,
  );
  const after =
    cursor === null
      ? gte(notifications.openedAt, new Date(now.getTime() - FIRST_CHECK_DAYS * 86_400_000))
      : cursor.id === null
        ? gt(notifications.openedAt, cursor.at)
        : or(
            gt(notifications.openedAt, cursor.at),
            and(eq(notifications.openedAt, cursor.at), sql`${notifications.id} > ${cursor.id}`),
          );
  const rows = await getDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.userId, ctx.userId),
        isNull(notifications.resolvedAt),
        inArray(notifications.event, events),
        after,
      ),
    )
    .orderBy(asc(notifications.openedAt), asc(notifications.id))
    .limit(options.limit ?? DEFAULT_FEED_LIMIT);
  const last = rows.at(-1);
  return {
    items: rows.map((row) => ({
      id: row.id,
      event: row.event,
      category: NOTIFICATION_EVENTS[row.event].category,
      params: row.params,
      target: targetOf(row),
      openedAt: row.openedAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    })),
    cursor: last ? `${last.openedAt.toISOString()}_${last.id}` : (options.since ?? now.toISOString()),
  };
}

/** Marks one of the person's notifications read; a second call keeps the first instant. */
export async function markRead(ctx: Pick<Ctx, "userId">, id: string, now: Date = new Date()): Promise<void> {
  const [row] = await getDb()
    .update(notifications)
    .set({ readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, ctx.userId)))
    .returning({ id: notifications.id });
  if (!row) throw new NotificationError("not_found");
}

/**
 * The channels of every event. `monthlySummary` is the person's own preference of the monthly
 * summary: the email channel of that event is that preference, not a second one.
 */
export async function notificationChoices(ctx: Pick<Ctx, "userId" | "addons">, monthlySummary: boolean) {
  const choices = await choicesOf(ctx);
  return {
    events: NOTIFICATION_EVENT_NAMES.map((event) => {
      const channels = choices.get(event) ?? defaultChannels(event);
      return {
        event,
        category: NOTIFICATION_EVENTS[event].category,
        addon: NOTIFICATION_EVENTS[event].addon,
        addonActive: eventActive(ctx, event),
        channels: event === "monthly_summary" ? { ...channels, email: monthlySummary } : channels,
        locked: lockedOf(event),
      };
    }),
  };
}

/** Changes the channels of one event; a channel left out keeps its value. Returns the new ones. */
export async function chooseChannels(
  ctx: Pick<Ctx, "userId" | "addons">,
  event: NotificationEvent,
  change: Partial<Channels>,
): Promise<Channels> {
  if (!eventActive(ctx, event)) throw new NotificationError("module_inactive");
  const fixed = defaultChannels(event);
  if (
    lockedOf(event).some((channel) => change[channel] !== undefined && change[channel] !== fixed[channel])
  ) {
    throw new NotificationError("invalid");
  }
  const channels = { ...((await choicesOf(ctx)).get(event) ?? fixed), ...change };
  await getDb()
    .insert(notificationPreferences)
    .values({ userId: ctx.userId, event, ...channels })
    .onConflictDoUpdate({
      target: [notificationPreferences.userId, notificationPreferences.event],
      set: channels,
    });
  return channels;
}
