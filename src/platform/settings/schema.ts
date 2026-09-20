import { sql } from "drizzle-orm";
import { check, customType, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";

/** `bytea` as a Node `Buffer`: `seal`/`open` (spec §9.4) speak Buffer, and pg returns one. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * Server-level settings (spec §6): one row per key, set by an admin. `value` holds what may be
 * shown again; `sealed` what may not (an API key), sealed with the key ring of spec §9.4 so a
 * database dump never carries it in clear. Not user-owned: only `requireAdmin` surfaces touch it.
 */
export const appSettings = pgTable(
  "app_settings",
  {
    key: text("key").primaryKey(),
    value: jsonb("value").$type<Record<string, unknown>>(),
    sealed: bytea("sealed"),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [check("app_settings_key_ck", sql`${table.key} ~ '^[a-z][a-z0-9_.]{0,63}$'`)],
);
