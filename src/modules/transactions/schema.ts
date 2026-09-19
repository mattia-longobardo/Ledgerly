import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema";
import { users } from "../../platform/auth/schema";
import { CATEGORY_TYPES, TRANSACTION_STATES, TRANSACTION_TYPES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Spending categories (spec §6), on two levels since F2.5: a group (no parent) and its
 * sub-categories. Unique on the name **among siblings**, because that is what adoption keys on
 * (spec §9.1) — "Other" under two groups is two categories — and `NULLS NOT DISTINCT` makes the
 * groups siblings of one another. An archived category keeps its name, so adoption never
 * resurrects it by accident.
 *
 * The two generated columns are how the database itself refuses a third level: a child points at
 * `(parent_id, true)`, and only a row without a parent has `is_root = true`. Giving a parent to a
 * group that has children fails too, because the key its children point at would change under
 * them. The key has no `ON DELETE` action — Postgres allows none on a key with a generated column —
 * and needs none: a category is archived, never deleted (spec §7.2), and deleting a user takes a
 * group and its children away in the same statement.
 */
export const categories = pgTable(
  "categories",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    parentId: uuid("parent_id"),
    isRoot: boolean("is_root").generatedAlwaysAs(sql`parent_id is null`),
    parentIsRoot: boolean("parent_is_root").generatedAlwaysAs(
      sql`case when parent_id is null then null else true end`,
    ),
    /**
     * The person chose this category's group — or no group — by hand (spec §7.2: local edits win).
     * The sync then never files it under the provider's group again; without it, taking a Wallet
     * category out of its group was undone by the next hourly pass.
     */
    parentSetLocally: boolean("parent_set_locally").notNull().default(false),
    type: text("type", { enum: CATEGORY_TYPES }).notNull().default("expense"),
    color: text("color"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("categories_id_root_uq").on(table.id, table.isRoot),
    foreignKey({
      name: "categories_parent_fk",
      columns: [table.parentId, table.parentIsRoot],
      foreignColumns: [table.id, table.isRoot],
    }),
    unique("categories_user_parent_name_uq").on(table.userId, table.parentId, table.name).nullsNotDistinct(),
    index("categories_user_name_idx").on(table.userId, table.name),
    index("categories_parent_idx").on(table.parentId),
    check("categories_type_ck", sql`${table.type} in (${sql.raw(inList(CATEGORY_TYPES))})`),
    check("categories_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
  ],
);

/** Free-form labels, matched to the provider's by name (spec §9.1). */
export const labels = pgTable(
  "labels",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("labels_user_name_uq").on(table.userId, table.name),
    check("labels_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
  ],
);

/**
 * One movement (spec §6, §7.2). The provider owns `payee`, `amountCents` and `occurredAt`; the
 * user owns category, labels, note and visibility, and every field they touch is appended to
 * `locallyEdited` so the next sync leaves it alone.
 *
 * The provider's own id is deliberately absent: it lives in `provider_links` (spec §4.3), which
 * is how `upsertFromProvider` recognises a movement it has already seen.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    type: text("type", { enum: TRANSACTION_TYPES }).notNull(),
    state: text("state", { enum: TRANSACTION_STATES }).notNull().default("cleared"),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    payee: text("payee"),
    note: text("note"),
    transferGroupId: uuid("transfer_group_id").references((): AnyPgColumn => transactions.id, {
      onDelete: "set null",
    }),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    removedUpstreamAt: timestamp("removed_upstream_at", { withTimezone: true }),
    locallyEdited: text("locally_edited")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("transactions_user_occurred_idx").on(table.userId, table.occurredAt.desc(), table.id),
    index("transactions_account_occurred_idx").on(table.accountId, table.occurredAt.desc()),
    index("transactions_user_category_idx").on(table.userId, table.categoryId),
    index("transactions_transfer_group_idx").on(table.transferGroupId),
    check("transactions_type_ck", sql`${table.type} in (${sql.raw(inList(TRANSACTION_TYPES))})`),
    check("transactions_state_ck", sql`${table.state} in (${sql.raw(inList(TRANSACTION_STATES))})`),
    check("transactions_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("transactions_sign_ck", sql`${table.type} <> 'expense' or ${table.amountCents} <= 0`),
    check("transactions_income_sign_ck", sql`${table.type} <> 'income' or ${table.amountCents} >= 0`),
  ],
);

/** A transaction's labels (spec §6). */
export const transactionLabels = pgTable(
  "transaction_labels",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    labelId: uuid("label_id")
      .notNull()
      .references(() => labels.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "transaction_labels_pk", columns: [table.transactionId, table.labelId] }),
    index("transaction_labels_label_idx").on(table.labelId),
    index("transaction_labels_user_idx").on(table.userId),
  ],
);

/**
 * A detected recurrence (spec §7.2). Keyed by the normalised payee, the currency and the sign, so
 * a monthly salary and a monthly direct debit to the same name stay two patterns.
 */
export const recurringPatterns = pgTable(
  "recurring_patterns",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payeeKey: text("payee_key").notNull(),
    currency: text("currency").notNull().default("EUR"),
    sign: smallint("sign").notNull(),
    intervalDays: integer("interval_days").notNull(),
    medianCents: bigint("median_cents", { mode: "bigint" }).notNull(),
    nextExpectedOn: date("next_expected_on").notNull(),
    occurrences: integer("occurrences").notNull(),
    lastSeenOn: date("last_seen_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("recurring_patterns_key_uq").on(table.userId, table.payeeKey, table.currency, table.sign),
    index("recurring_patterns_user_next_idx").on(table.userId, table.nextExpectedOn),
    check("recurring_patterns_sign_ck", sql`${table.sign} in (-1, 1)`),
    check("recurring_patterns_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("recurring_patterns_interval_ck", sql`${table.intervalDays} between 1 and 400`),
    check("recurring_patterns_occurrences_ck", sql`${table.occurrences} >= 3`),
  ],
);
