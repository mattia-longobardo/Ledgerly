import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../auth/schema";

/**
 * Personal access tokens (spec §5.3, §6): the read-mostly API used by Home Assistant and scripts.
 *
 * Only `prefix` and `token_hash` are kept — the value itself is shown once and is not recoverable.
 * A token is of a *platform* concern rather than a module's: it authenticates, exactly as a
 * session does, and like `settings`, `notifications` and `integrations` it keeps its own schema
 * under `src/platform/`.
 */
export const personalAccessTokens = pgTable(
  "personal_access_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** What the person wrote on it: "Home Assistant", "backup script". */
    name: text("name").notNull(),
    /** The eight characters that may be shown again, and the way a row is found. */
    prefix: text("prefix").notNull().unique(),
    /** sha256 of the secret, hex (plan F8 §3.2: not argon2 — see `rules.ts`). */
    tokenHash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    /** Optional (spec §5.3): a token with no end date is valid until it is revoked. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("personal_access_tokens_user_idx").on(table.userId, table.createdAt.desc()),
    check(
      "personal_access_tokens_scopes_ck",
      sql`${table.scopes} <> '{}' and ${table.scopes} <@ array['read','write','imports']`,
    ),
    check("personal_access_tokens_name_ck", sql`length(${table.name}) between 1 and 60`),
    check("personal_access_tokens_prefix_ck", sql`${table.prefix} ~ '^[a-z0-9]{8}$'`),
  ],
);
