import { check, index, integer, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const transactionCategories = pgTable(
  "transaction_categories",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    groupName: text("group_name"),
    kind: text("kind").notNull().default("expense"),
    color: text("color"),
    // Not FK-constrained: a self-reference would need a circular Drizzle type.
    // `createCategory`/`updateCategory` set it, nothing reads the hierarchy
    // yet, and the parent's existence is checked at the application layer.
    parentId: uuid("parent_id"),
    source: text("source").notNull().default("manual"),
    archivedAt: tz("archived_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transaction_categories_kind_ck", sql`${t.kind} IN ('income','expense','transfer','system')`),
    check("transaction_categories_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("transaction_categories_user_name_uq").on(t.userId, t.name),
  ],
);

export const transactionLabels = pgTable(
  "transaction_labels",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    name: text("name").notNull(),
    color: text("color"),
    source: text("source").notNull().default("manual"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transaction_labels_source_ck", sql`${t.source} IN ('manual','provider','system','migration')`),
    uniqueIndex("transaction_labels_user_name_uq").on(t.userId, t.name),
  ],
);

export const transactions = pgTable(
  "transactions",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: tz("occurred_at").notNull(),
    bookedAt: tz("booked_at"),
    amount: money("amount").notNull(),
    currency: text("currency").notNull().default("EUR"),
    type: text("type").notNull().default("expense"),
    state: text("state").notNull().default("cleared"),
    categoryId: uuid("category_id").references(() => transactionCategories.id, { onDelete: "set null" }),
    payee: text("payee"),
    note: text("note"),
    transferGroupId: uuid("transfer_group_id"),
    source: text("source").notNull().default("manual"),
    // No FK, matching account_balances.sync_run_id's existing precedent: the
    // integrations module owns sync_runs and this table does not depend on it.
    syncRunId: uuid("sync_run_id"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("transactions_type_ck", sql`${t.type} IN ('income','expense','transfer')`),
    check("transactions_state_ck", sql`${t.state} IN ('pending','cleared','reconciled')`),
    check("transactions_currency_ck", sql`char_length(${t.currency}) = 3`),
    index("transactions_user_occurred_idx").on(t.userId, t.occurredAt.desc()),
    index("transactions_account_occurred_idx").on(t.accountId, t.occurredAt.desc()),
    index("transactions_user_category_idx").on(t.userId, t.categoryId, t.occurredAt),
  ],
);

export const transactionLabelLinks = pgTable(
  "transaction_label_links",
  {
    transactionId: uuid("transaction_id").notNull().references(() => transactions.id, { onDelete: "cascade" }),
    labelId: uuid("label_id").notNull().references(() => transactionLabels.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.transactionId, t.labelId] })],
);

export const recurringPatterns = pgTable(
  "recurring_patterns",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    payee: text("payee").notNull(),
    cadence: text("cadence").notNull(),
    amountLow: money("amount_low").notNull(),
    amountHigh: money("amount_high").notNull(),
    currency: text("currency").notNull().default("EUR"),
    // Signed alongside `currency`: the detector groups by payee + currency +
    // amount sign (see `domain/recurring.ts`), and two groups sharing a payee
    // can differ only by sign (recurring income vs. recurring expense) — the
    // uniqueness constraint below must match that grouping key exactly, or a
    // legitimate second series collides with the first (Ruling P3-C42).
    sign: text("sign").notNull(),
    lastSeenAt: tz("last_seen_at").notNull(),
    nextExpectedAt: tz("next_expected_at"),
    occurrenceCount: integer("occurrence_count").notNull().default(0),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("recurring_patterns_cadence_ck", sql`${t.cadence} IN ('weekly','biweekly','monthly','quarterly','annual')`),
    check("recurring_patterns_sign_ck", sql`${t.sign} IN ('+','-')`),
    uniqueIndex("recurring_patterns_user_payee_currency_sign_uq").on(t.userId, t.payee, t.currency, t.sign),
  ],
);

export type TransactionCategoryRow = typeof transactionCategories.$inferSelect;
export type TransactionLabelRow = typeof transactionLabels.$inferSelect;
export type TransactionRow = typeof transactions.$inferSelect;
export type RecurringPatternRow = typeof recurringPatterns.$inferSelect;
