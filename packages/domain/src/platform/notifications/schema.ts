import { sql } from "drizzle-orm";
import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";

/**
 * One row per thing the app has told a user about (spec §6, §10.4). The `(user, kind, key)` key is
 * what stops a condition that lasts for weeks — a stale sync, a balance under its threshold — from
 * sending the same email every day.
 */
export const notificationsLog = pgTable(
  "notifications_log",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    key: text("key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("notifications_log_user_kind_key_uq").on(table.userId, table.kind, table.key)],
);
