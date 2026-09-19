import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { accounts } from "../accounts/schema";
import { ACCRUAL_STATUSES, DAY_BASES, POSTING_STATES, RULE_MODES, RULE_STATES, SETTLEMENTS } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * How an account earns interest (spec §6, §7.6): tiers, tax withheld, day basis, settlement
 * frequency, validity, and whether the settlements are published to Wallet. `payee_match` (F4, plan
 * §3.6.1) is how the interest the bank really paid is recognised among the account's income.
 * `on delete no action` on the account: an account a rule points at is archived instead (F3).
 */
export const interestRules = pgTable(
  "interest_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    taxRate: numeric("tax_rate", { precision: 10, scale: 6 }).notNull().default("0.26"),
    dayBasis: text("day_basis", { enum: DAY_BASES }).notNull().default("365"),
    settlement: text("settlement", { enum: SETTLEMENTS }).notNull().default("monthly"),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    mode: text("mode", { enum: RULE_MODES }).notNull().default("analyze_only"),
    state: text("state", { enum: RULE_STATES }).notNull().default("active"),
    payeeMatch: text("payee_match"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("interest_rules_account_idx").on(table.accountId),
    index("interest_rules_user_idx").on(table.userId, table.validFrom, table.id),
    check("interest_rules_tax_ck", sql`${table.taxRate} between 0 and 1`),
    check("interest_rules_basis_ck", sql`${table.dayBasis} in (${sql.raw(inList(DAY_BASES))})`),
    check("interest_rules_settlement_ck", sql`${table.settlement} in (${sql.raw(inList(SETTLEMENTS))})`),
    check("interest_rules_mode_ck", sql`${table.mode} in (${sql.raw(inList(RULE_MODES))})`),
    check("interest_rules_state_ck", sql`${table.state} in (${sql.raw(inList(RULE_STATES))})`),
    check(
      "interest_rules_validity_ck",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      "interest_rules_match_ck",
      sql`${table.payeeMatch} is null or length(btrim(${table.payeeMatch})) between 1 and 80`,
    ),
  ],
);

/**
 * A rule's tiers (spec §7.6): the first rate up to its threshold, the next on the part above, and
 * so on; only the last has no threshold.
 */
export const interestRuleTiers = pgTable(
  "interest_rule_tiers",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => interestRules.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    upToCents: bigint("up_to_cents", { mode: "bigint" }),
    annualRate: numeric("annual_rate", { precision: 10, scale: 6 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("interest_rule_tiers_position_uq").on(table.ruleId, table.position),
    uniqueIndex("interest_rule_tiers_open_uq")
      .on(table.ruleId)
      .where(sql`${table.upToCents} is null`),
    check("interest_rule_tiers_position_ck", sql`${table.position} between 0 and 9`),
    check("interest_rule_tiers_threshold_ck", sql`${table.upToCents} is null or ${table.upToCents} > 0`),
    check("interest_rule_tiers_rate_ck", sql`${table.annualRate} between 0 and 1`),
  ],
);

/**
 * A period's settlement (spec §7.6 "Liquidazione"): the day nets of the period added up, and — for
 * a rule that publishes — where its Wallet posting stands. The Wallet record's id lives in
 * `provider_links` (spec §4.3), never here.
 */
export const interestEntries = pgTable(
  "interest_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => interestRules.id, { onDelete: "cascade" }),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    settleOn: date("settle_on").notNull(),
    grossCents: bigint("gross_cents", { mode: "bigint" }).notNull(),
    taxCents: bigint("tax_cents", { mode: "bigint" }).notNull(),
    netCents: bigint("net_cents", { mode: "bigint" }).notNull(),
    posting: text("posting", { enum: POSTING_STATES }).notNull().default("none"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    postingError: text("posting_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("interest_entries_period_uq").on(table.ruleId, table.periodFrom),
    index("interest_entries_user_idx").on(table.userId, table.settleOn),
    check("interest_entries_posting_ck", sql`${table.posting} in (${sql.raw(inList(POSTING_STATES))})`),
    check(
      "interest_entries_period_ck",
      sql`${table.periodFrom} <= ${table.periodTo} and ${table.periodTo} < ${table.settleOn}`,
    ),
    check(
      "interest_entries_net_ck",
      sql`${table.netCents} >= 0 and ${table.grossCents} >= 0 and ${table.taxCents} >= 0`,
    ),
  ],
);

/**
 * One rule's interest for one day (spec §7.6), in fixed point: `gross` and `carry` keep twelve
 * decimals so the day's rounding never depends on a float. A day with no known or a negative
 * balance is a row too — skipped visibly, never silently.
 */
export const interestAccruals = pgTable(
  "interest_accruals",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ruleId: uuid("rule_id")
      .notNull()
      .references(() => interestRules.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    balanceCents: bigint("balance_cents", { mode: "bigint" }),
    gross: numeric("gross", { precision: 24, scale: 12 }).notNull(),
    netCents: bigint("net_cents", { mode: "bigint" }).notNull(),
    carry: numeric("carry", { precision: 24, scale: 12 }).notNull(),
    status: text("status", { enum: ACCRUAL_STATUSES }).notNull(),
    entryId: uuid("entry_id").references((): AnyPgColumn => interestEntries.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("interest_accruals_day_uq").on(table.ruleId, table.on),
    index("interest_accruals_entry_idx").on(table.entryId),
    check("interest_accruals_status_ck", sql`${table.status} in (${sql.raw(inList(ACCRUAL_STATUSES))})`),
    check("interest_accruals_net_ck", sql`${table.netCents} >= 0`),
  ],
);
