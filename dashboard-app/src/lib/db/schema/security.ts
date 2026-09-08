import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);

/**
 * Personal access tokens (R8-5). The plain token is `pat_<8>.<43>` and is
 * shown to its owner exactly once: this table keeps only the human-readable
 * `prefix` and the sha256 of the whole token, so a database dump cannot be
 * replayed against the API.
 *
 * `scopes` is a subset of the user's permissions at creation, and is
 * re-intersected with their current permissions at every use — a role
 * downgrade shrinks live tokens rather than leaving them oversized.
 *
 * The rest of the original Phase 8 security schema (sessions, MFA,
 * invitations) is deferred; see `docs/superpowers/DEFERRED.md`.
 */
export const personalAccessTokens = pgTable("personal_access_tokens", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
  expiresAt: tz("expires_at"),
  lastUsedAt: tz("last_used_at"),
  revokedAt: tz("revoked_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  uniqueIndex("personal_access_tokens_hash_uq").on(t.tokenHash),
  index("personal_access_tokens_user_idx").on(t.userId),
]);

export type PersonalAccessTokenRow = typeof personalAccessTokens.$inferSelect;
