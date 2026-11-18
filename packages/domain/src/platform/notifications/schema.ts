import { pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
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
