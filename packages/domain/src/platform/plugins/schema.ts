import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { users } from "../auth/schema";
import type { PluginManifest } from "@ledgerly/plugin-contract";

/** `bytea` as a Node `Buffer`: what `seal` produces and `open` reads. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

/**
 * The plugins of this instance (rewrite plan, 04-now.md §4.1): one row per plugin the server's
 * configuration names, written when the core has read its manifest. Nobody installs a plugin from
 * the interface (decision H25); the address is kept here only to say where the manifest came from.
 * The shared secret is never stored: it stays in the environment.
 */
export const plugins = pgTable(
  "plugins",
  {
    id: text("id").primaryKey(),
    url: text("url").notNull(),
    manifest: jsonb("manifest").$type<PluginManifest>().notNull(),
    contract: text("contract").notNull(),
    /** `ready`: the last reading of the manifest succeeded. `unreachable`: it did not. */
    state: text("state").notNull().default("ready"),
    /** Whether the plugin is of the official catalog. Every plugin is (decision H28). */
    verified: boolean("verified").notNull().default(true),
    manifestReadAt: moment("manifest_read_at").notNull().defaultNow(),
    /** Since when the plugin has not answered, in the current series of failed checks. */
    unreachableSince: moment("unreachable_since"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check("plugins_id_ck", sql`${table.id} ~ '^[a-z][a-z0-9-]{1,30}$'`),
    check("plugins_state_ck", sql`${table.state} in ('ready', 'unreachable')`),
  ],
);

/**
 * Whether a person has turned a plugin on (decision H25): each person turns on their own, and no
 * row means "never turned on". `deactivatedAt` is the last time it was turned off, for the line
 * "readings have been stopped since".
 */
export const pluginActivations = pgTable(
  "plugin_activations",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    active: boolean("active").notNull(),
    activatedAt: moment("activated_at"),
    deactivatedAt: moment("deactivated_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [primaryKey({ name: "plugin_activations_pk", columns: [table.userId, table.pluginId] })],
);

/**
 * The credentials one person gave one plugin (04-now.md §4.2), sealed like those of a connection:
 * a dump carries no usable key, and only `readUserCredentials` opens the blob. `invalidAt` is set
 * when the provider refuses them, and cleared when the person replaces them.
 */
export const pluginUserCredentials = pgTable(
  "plugin_user_credentials",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    credentials: bytea("credentials").notNull(),
    savedAt: moment("saved_at").notNull().defaultNow(),
    invalidAt: moment("invalid_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [unique("plugin_user_credentials_user_plugin_uq").on(table.userId, table.pluginId)],
);

/**
 * An access a person has started and not finished yet: what ties the provider's return to the
 * session that left. Only the hash of the `state` is kept, so a row read from a dump cannot
 * complete anybody's access; `sessionId` is the session that started it; a row is used once.
 */
export const pluginAuthStates = pgTable(
  "plugin_auth_states",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id").notNull(),
    stateHash: text("state_hash").notNull(),
    sessionId: text("session_id").notNull(),
    /** What the person chose: the institution, and the connection to renew when there is one. */
    payload: jsonb("payload").$type<Record<string, string>>().notNull(),
    expiresAt: moment("expires_at").notNull(),
    consumedAt: moment("consumed_at"),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("plugin_auth_states_hash_uq").on(table.stateHash),
    index("plugin_auth_states_expires_idx").on(table.expiresAt),
  ],
);
