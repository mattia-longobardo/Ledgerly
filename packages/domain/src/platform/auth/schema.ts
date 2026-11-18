import { sql } from "drizzle-orm";
import { bigint, boolean, check, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../db/columns";

// Column sets follow Better Auth 1.7 (core + admin and two-factor plugins + database rate limit).
// Better Auth validates export keys and column property names at startup, not SQL types.

export const users = pgTable("users", {
  id: idColumn(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: moment("ban_expires"),
  // Set by the two-factor plugin once a TOTP code has confirmed the secret (docs/auth-design.md D2).
  twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    expiresAt: moment("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    impersonatedBy: text("impersonated_by"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: moment("access_token_expires_at"),
    refreshTokenExpiresAt: moment("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("auth_accounts_user_id_idx").on(table.userId),
    unique("auth_accounts_provider_account_uq").on(table.providerId, table.accountId),
  ],
);

export const verifications = pgTable(
  "verifications",
  {
    id: idColumn(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: moment("expires_at").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

/**
 * One row per user who has started TOTP enrollment. `secret` and `backup_codes` are encrypted by
 * Better Auth with `BETTER_AUTH_SECRET` (symmetricEncrypt), never stored in clear. `verified` is
 * false until the first code confirms the secret; the failure counter and `locked_until` are the
 * plugin's per-account lockout (10 failures, 15 min).
 */
export const twoFactors = pgTable("two_factors", {
  id: idColumn(),
  userId: uuid("user_id")
    .notNull()
    .unique()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret").notNull(),
  backupCodes: text("backup_codes").notNull(),
  verified: boolean("verified").notNull().default(true),
  failedVerificationCount: integer("failed_verification_count").notNull().default(0),
  lockedUntil: moment("locked_until"),
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
});

/**
 * The one table without `created_at`/`updated_at` (spec §6 exception): Better Auth owns its shape
 * and its rows are ephemeral counters, overwritten on every request.
 */
export const rateLimits = pgTable("rate_limits", {
  id: idColumn(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** Sign-up is closed: a person joins through an invitation (spec §5.1). Server-level, not user-owned. */
export const invitations = pgTable(
  "invitations",
  {
    id: idColumn(),
    email: text("email").notNull(),
    role: text("role", { enum: ["admin", "user"] })
      .notNull()
      .default("user"),
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: moment("expires_at").notNull(),
    acceptedAt: moment("accepted_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("invitations_email_idx").on(table.email),
    check("invitations_role_ck", sql`${table.role} in ('admin', 'user')`),
  ],
);
