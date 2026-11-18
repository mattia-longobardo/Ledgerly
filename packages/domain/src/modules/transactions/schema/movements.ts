import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { accounts } from "../../accounts/schema";
import { users } from "../../../platform/auth/schema";
import {
  CATEGORY_ORIGINS,
  SEND_STATES,
  TRANSACTION_ORIGINS,
  TRANSACTION_STATES,
  TRANSACTION_TYPES,
} from "../rules";
import { categories, categoryRules, labels, sourceCategories } from "./categories";
import { inList } from "../../../platform/db/checks";

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
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: moment("occurred_at").notNull(),
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
    // The rule that gave the category, while `categoryOrigin` is `rule` (categories-and-rules.md §4.5).
    categoryRuleId: uuid("category_rule_id").references(() => categoryRules.id, { onDelete: "set null" }),
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
    // A manual movement of a "read and write" account that its source has not taken yet (N3.1).
    sendState: text("send_state", { enum: SEND_STATES }),
    // The day the source was last asked to create the movement on: where the next update looks
    // for it before it asks again, whatever the person changed since.
    sendAskedOn: date("send_asked_on"),
    // The category the source gave the movement: it stays whatever category that counts under here.
    sourceCategoryId: uuid("source_category_id").references(() => sourceCategories.id, {
      onDelete: "set null",
    }),
    hiddenAt: moment("hidden_at"),
    removedUpstreamAt: moment("removed_upstream_at"),
    locallyEdited: text("locally_edited")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
    // The movements that wait for their source: a handful, read at every update.
    index("transactions_send_idx")
      .on(table.userId, table.accountId)
      .where(sql`${table.sendState} is not null`),
    index("transactions_source_category_idx")
      .on(table.sourceCategoryId)
      .where(sql`${table.sourceCategoryId} is not null`),
    check(
      "transactions_send_state_ck",
      sql`${table.sendState} is null or (${table.sendState} in (${sql.raw(inList(SEND_STATES))}) and ${table.origin} = 'manual')`,
    ),
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
    createdAt: createdAtColumn(),
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
