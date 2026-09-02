import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const accountGroups = pgTable(
  "account_groups",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("account_groups_user_name_uq").on(t.userId, t.name)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    groupId: uuid("group_id").references(() => accountGroups.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    currency: text("currency").notNull().default("EUR"),
    origin: text("origin").notNull(),
    provider: text("provider"),
    status: text("status").notNull().default("active"),
    includeInNetWorth: boolean("include_in_net_worth").notNull().default(true),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    version: integer("version").notNull().default(1),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
  },
  (t) => [
    check("accounts_type_ck", sql`${t.type} IN ('checking','savings','cash','investment','pension_fund','crypto','credit','other')`),
    check("accounts_origin_ck", sql`${t.origin} IN ('manual','synced')`),
    check("accounts_status_ck", sql`${t.status} IN ('active','unavailable','archived')`),
    check("accounts_currency_ck", sql`char_length(${t.currency}) = 3`),
    index("accounts_user_idx").on(t.userId, t.sortOrder),
  ],
);

export const accountBalances = pgTable(
  "account_balances",
  {
    id: id(),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    asOf: date("as_of").notNull(),
    balance: money("balance").notNull(),
    available: money("available"),
    source: text("source").notNull(),
    capturedAt: tz("captured_at").notNull().defaultNow(),
    syncRunId: uuid("sync_run_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("account_balances_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("account_balances_uq").on(t.accountId, t.asOf, t.source),
    index("account_balances_account_asof_idx").on(t.accountId, t.asOf.desc()),
  ],
);

export const providerLinks = pgTable(
  "provider_links",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    externalId: text("external_id").notNull(),
    externalParentId: text("external_parent_id"),
    metadata: jsonb("metadata").notNull().default({}),
    firstSeenAt: tz("first_seen_at").notNull().defaultNow(),
    lastSeenAt: tz("last_seen_at").notNull().defaultNow(),
    missingSince: tz("missing_since"),
  },
  (t) => [
    uniqueIndex("provider_links_external_uq").on(t.provider, t.entityType, t.externalId),
    uniqueIndex("provider_links_entity_uq").on(t.provider, t.entityType, t.entityId),
  ],
);

export type AccountRow = typeof accounts.$inferSelect;
export type AccountBalanceRow = typeof accountBalances.$inferSelect;
export type ProviderLinkRow = typeof providerLinks.$inferSelect;
export type AccountGroupRow = typeof accountGroups.$inferSelect;
