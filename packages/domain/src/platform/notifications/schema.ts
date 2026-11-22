import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { NOTIFICATION_EVENT_NAMES, type NotificationParams } from "@ledgerly/api-contract";
import { checkIn, createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { users } from "../auth/schema";

/**
 * One row per thing the app has told a user about (spec §6, §10.4). The `(user, kind, key)` key is
 * what stops a condition that lasts for weeks — a stale sync, a balance under its threshold — from
 * sending the same email every day.
 */
export const notificationsLog = pgTable(
  "notifications_log",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    sentAt: moment("sent_at").notNull().defaultNow(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [unique("notifications_log_user_kind_key_uq").on(table.userId, table.kind, table.key)],
);

/**
 * The notifications to read (rewrite plan R5e): one row per fact. A fact has at most one open row
 * (`resolved_at` null), which is what keeps «mai due avvisi per lo stesso fatto». The category and
 * the addon of a row are its event's, in the catalogue of the contract.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event", { enum: NOTIFICATION_EVENT_NAMES }).notNull(),
    /** The fact: a connection's id, `budget|month|threshold`, a month. Unique within the event. */
    subject: text("subject").notNull(),
    /** Counts, whole percents, days, dates only (G4): never an amount, a bank, an account, a name. */
    params: jsonb("params").$type<NotificationParams>().notNull().default({}),
    /** What the page the client opens is about: a connection, an account, a budget, a fund. */
    targetId: text("target_id"),
    openedAt: moment("opened_at").notNull().defaultNow(),
    lastRaisedAt: moment("last_raised_at").notNull().defaultNow(),
    readAt: moment("read_at"),
    resolvedAt: moment("resolved_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    checkIn("notifications_event_ck", table.event, NOTIFICATION_EVENT_NAMES),
    uniqueIndex("notifications_open_uq")
      .on(table.userId, table.event, table.subject)
      .where(sql`${table.resolvedAt} is null`),
    index("notifications_user_opened_idx").on(table.userId, table.openedAt),
  ],
);

/** The channels a person chose for an event; no row is the event's default. */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    event: text("event", { enum: NOTIFICATION_EVENT_NAMES }).notNull(),
    inApp: boolean("in_app").notNull(),
    email: boolean("email").notNull(),
    device: boolean("device").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    checkIn("notification_preferences_event_ck", table.event, NOTIFICATION_EVENT_NAMES),
    unique("notification_preferences_user_event_uq").on(table.userId, table.event),
  ],
);
