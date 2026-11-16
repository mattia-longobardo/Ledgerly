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
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "../accounts/schema";
import { users } from "../../platform/auth/schema";
import {
  CATEGORY_ORIGINS,
  CATEGORY_TYPES,
  TRANSACTION_ORIGINS,
  TRANSACTION_STATES,
  TRANSACTION_TYPES,
} from "./rules";

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
    /**
     * The fields the person changed here, exactly as `transactions.locally_edited` records them
     * (spec §7.2). Since the two-way category sync it means something more precise than "never
     * overwrite this again": a `name` in this list is what makes the local name **win**, and the
     * next pass writes it to Wallet (`platform/integrations/wallet/categories.ts`) and then clears
     * the marker, because once Wallet has been told the two agree and a later rename *there* is
     * free to come back here. `type` never leaves: Wallet has no notion of income or expense, so a
     * type chosen here is local for ever.
     */
    locallyEdited: text("locally_edited")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * The name Wallet published for this category the last time the two sides agreed — the
     * baseline of the three-way merge, and the only way to tell "only here changed" from "both
     * changed" (which is reported, spec §7.2). `null` for a category Wallet has never seen, and
     * for the rows that predate this column: those fall back to "a local edit wins, otherwise
     * Wallet's name is adopted", which is what the one-way sync did.
     */
    providerName: text("provider_name"),
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
    // What a bank wrote about the movement, as it wrote it (rewrite plan, 06-data.md §6.1): kept
    // for the automatic categories of N3. Filled by a provider that reads a bank; null elsewhere.
    rawText: text("raw_text"),
    counterpartyName: text("counterparty_name"),
    merchantCategoryCode: text("merchant_category_code"),
    bankTransactionCode: text("bank_transaction_code"),
    // The automatic categories (rewrite plan N3, 04-now.md §4.4). `categoryOrigin` says who chose
    // `categoryId`; the confidence and the model's version describe an automatic choice and never
    // leave the server. A suggestion is a category that does not count yet: it is kept apart from
    // `categoryId`, so every total reads the movement as it reads one with no category.
    categoryOrigin: text("category_origin", { enum: CATEGORY_ORIGINS }),
    categoryConfidence: real("category_confidence"),
    categoryModelVersion: integer("category_model_version"),
    suggestedCategoryId: uuid("suggested_category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    // Why the category was given or suggested: a code of a closed list, and what its sentence names.
    categoryReason: text("category_reason"),
    categoryReasonParams: jsonb("category_reason_params").$type<Record<string, string>>(),
    // The key of the movement's text (`memoryKey`), written when the cascade reads the movement:
    // what "similar movements" and the groups of "To review" are found by. `null` on a movement
    // the cascade never reads — one of a source that gives its own categories.
    categoryKey: text("category_key"),
    transferGroupId: uuid("transfer_group_id").references((): AnyPgColumn => transactions.id, {
      onDelete: "set null",
    }),
    // Who wrote the row (rewrite plan N3). The default keeps every row an image without this
    // column writes what it is: a provider's.
    origin: text("origin", { enum: TRANSACTION_ORIGINS }).notNull().default("provider"),
    // The key the dialog sent a manual movement with: the same key sent twice is one row.
    idempotencyKey: text("idempotency_key"),
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
    // The manual movements of an account, for the balance after them: a handful of rows found
    // without walking the thousands a provider wrote on the same account.
    index("transactions_manual_idx")
      .on(table.accountId, table.occurredAt)
      .where(sql`${table.origin} = 'manual'`),
    // The movements that wait for a category, for the count the notice of Expenses reads: a few
    // rows found without walking the range.
    index("transactions_waiting_idx")
      .on(table.userId, table.occurredAt)
      .where(sql`${table.categoryId} is null and ${table.categoryKey} is not null`),
    index("transactions_user_category_key_idx")
      .on(table.userId, table.categoryKey)
      .where(sql`${table.categoryKey} is not null`),
    check(
      "transactions_category_origin_ck",
      sql`${table.categoryOrigin} is null or ${table.categoryOrigin} in (${sql.raw(inList(CATEGORY_ORIGINS))})`,
    ),
    uniqueIndex("transactions_user_idempotency_uq")
      .on(table.userId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    check("transactions_origin_ck", sql`${table.origin} in (${sql.raw(inList(TRANSACTION_ORIGINS))})`),
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

/* The automatic categories (rewrite plan N3, 04-now.md §4.4). Everything below is one person's:
   it goes with them (`on delete cascade`), and none of it is in an export, the API or MCP. */

/**
 * The strict memory: the texts a person or a source put in the same category the last three
 * times. Rewritten at every training from the confirmed labels (`strictMemory`).
 */
export const categoryMemory = pgTable(
  "category_memory",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ name: "category_memory_pk", columns: [table.userId, table.key] })],
);

/**
 * A person's classifier, one row: the model as it was last trained, its two thresholds, and what it
 * was trained from — so a reading that brings no new label trains nothing again. `preparing` is
 * true while a pass of the cascade is running, for the screen that waits for it.
 */
export const categoryModels = pgTable("category_models", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  /** How many confirmed labels the model was trained from, and the newest of them. */
  examples: integer("examples").notNull().default(0),
  labelledThrough: timestamp("labelled_through", { withTimezone: true }),
  automaticThreshold: real("automatic_threshold"),
  suggestionThreshold: real("suggestion_threshold"),
  model: jsonb("model"),
  preparing: boolean("preparing").notNull().default(false),
  trainedAt: timestamp("trained_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** The category a person made from a default group: what a static table points at for them. */
export const categoryGroupMarks = pgTable(
  "category_group_marks",
  {
    categoryId: uuid("category_id")
      .primaryKey()
      .references(() => categories.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupKey: text("group_key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("category_group_marks_user_group_uq").on(table.userId, table.groupKey)],
);

/** Two categories a person said are not the same: the proposal to merge them does not come back. */
export const categoryMergeDismissals = pgTable(
  "category_merge_dismissals",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The two ids in order, the smaller first: a pair is one row whichever way it is said. */
    firstId: uuid("first_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    secondId: uuid("second_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "category_merge_dismissals_pk",
      columns: [table.userId, table.firstId, table.secondId],
    }),
  ],
);

/** What a movement's category was before an action on several movements, for "Undo". */
export interface CategoryUndoRow {
  id: string;
  categoryId: string | null;
  categoryOrigin: string | null;
  categoryConfidence: number | null;
  categoryModelVersion: number | null;
  suggestedCategoryId: string | null;
  categoryReason: string | null;
  categoryReasonParams: Record<string, string> | null;
  locallyEdited: string[];
}

/**
 * The state before an action on several movements (a group of "To review", "Apply to N"): "Undo"
 * puts it back and removes the row. Kept on the server so a browser never says what a movement's
 * category was. Old rows are removed when a new one is written.
 */
export const categoryUndos = pgTable(
  "category_undos",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rows: jsonb("rows").$type<CategoryUndoRow[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("category_undos_user_idx").on(table.userId, table.createdAt)],
);
