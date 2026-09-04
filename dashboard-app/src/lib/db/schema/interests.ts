import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const interestRules = pgTable(
  "interest_rules",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    // 6-decimal precision: a rate like 0.022500 needs more than the 2-decimal
    // money() columns give, and the carry in interest_accruals needs it too.
    annualRate: numeric("annual_rate", { precision: 10, scale: 6 }).notNull(),
    taxRate: numeric("tax_rate", { precision: 10, scale: 6 }).notNull().default("0"),
    dayCount: text("day_count").notNull().default("365"),
    compounding: text("compounding").notNull().default("simple_daily"),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    postingMode: text("posting_mode").notNull().default("analyze_only"),
    providerCategoryRef: text("provider_category_ref"),
    noteMarker: text("note_marker").notNull().default("auto-interest"),
    version: integer("version").notNull().default(1),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_rules_day_count_ck", sql`${t.dayCount} IN ('365','360','actual')`),
    check("interest_rules_compounding_ck", sql`${t.compounding} IN ('simple_daily','monthly','none')`),
    check("interest_rules_posting_mode_ck", sql`${t.postingMode} IN ('analyze_only','post_to_provider')`),
    index("interest_rules_user_idx").on(t.userId),
  ],
);

export const interestAccruals = pgTable(
  "interest_accruals",
  {
    id: id(),
    ruleId: uuid("rule_id").notNull().references(() => interestRules.id, { onDelete: "cascade" }),
    accrualDate: date("accrual_date").notNull(),
    balanceBasis: money("balance_basis").notNull(),
    gross: numeric("gross", { precision: 16, scale: 6 }).notNull(),
    tax: numeric("tax", { precision: 16, scale: 6 }).notNull(),
    net: money("net").notNull(),
    carryAfter: numeric("carry_after", { precision: 16, scale: 6 }).notNull(),
    source: text("source").notNull().default("computed"),
    postedAt: tz("posted_at"),
    entryId: uuid("entry_id"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_accruals_source_ck", sql`${t.source} IN ('computed')`),
    uniqueIndex("interest_accruals_rule_date_uq").on(t.ruleId, t.accrualDate),
  ],
);

export const interestEntries = pgTable(
  "interest_entries",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    accountId: uuid("account_id").notNull().references(() => accounts.id, { onDelete: "cascade" }),
    occurredAt: tz("occurred_at").notNull(),
    gross: money("gross").notNull(),
    net: money("net").notNull(),
    kind: text("kind").notNull(),
    // No FK: a transaction may not exist locally yet (a projected entry has
    // none at all), matching transactions.sync_run_id's existing precedent.
    transactionId: uuid("transaction_id"),
    ruleId: uuid("rule_id"),
    source: text("source").notNull().default("computed"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("interest_entries_kind_ck", sql`${t.kind} IN ('paid','projected','adjustment')`),
    index("interest_entries_user_occurred_idx").on(t.userId, t.occurredAt.desc()),
  ],
);

export type InterestRuleRow = typeof interestRules.$inferSelect;
export type InterestAccrualRow = typeof interestAccruals.$inferSelect;
export type InterestEntryRow = typeof interestEntries.$inferSelect;
