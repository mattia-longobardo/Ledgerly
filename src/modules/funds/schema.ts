import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { accounts, balanceEntries } from "../accounts/schema";
import { transactions } from "../transactions/schema";
import { DEPOSIT_SOURCES, FUND_STATES, FUND_TYPES, VALUATION_SOURCES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A fund (spec §6, §7.7): a PAC in F4, a pension fund from F6. Its value is the balance of its
 * valuation account, so net worth has one source. `monthly_cents` and `deposit_fee_cents` come from
 * the design (plan F4 §3.6.4): the plan's instalment, and the fixed fee taken on each deposit.
 */
export const funds = pgTable(
  "funds",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: FUND_TYPES }).notNull(),
    provider: text("provider"),
    isin: text("isin"),
    compartment: text("compartment"),
    valuationAccountId: uuid("valuation_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    debitAccountId: uuid("debit_account_id").references(() => accounts.id, { onDelete: "no action" }),
    debitDay: smallint("debit_day"),
    ter: numeric("ter", { precision: 10, scale: 6 }),
    startOn: date("start_on").notNull(),
    monthlyCents: bigint("monthly_cents", { mode: "bigint" }),
    depositFeeCents: bigint("deposit_fee_cents", { mode: "bigint" }),
    state: text("state", { enum: FUND_STATES }).notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("funds_valuation_account_uq").on(table.valuationAccountId),
    unique("funds_user_name_uq").on(table.userId, table.name),
    index("funds_debit_account_idx").on(table.debitAccountId),
    check("funds_type_ck", sql`${table.type} in (${sql.raw(inList(FUND_TYPES))})`),
    check("funds_state_ck", sql`${table.state} in (${sql.raw(inList(FUND_STATES))})`),
    check("funds_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("funds_isin_ck", sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`),
    check("funds_debit_day_ck", sql`${table.debitDay} is null or ${table.debitDay} between 1 and 31`),
    check("funds_ter_ck", sql`${table.ter} is null or ${table.ter} between 0 and 1`),
    check("funds_monthly_ck", sql`${table.monthlyCents} is null or ${table.monthlyCents} > 0`),
    check("funds_fee_ck", sql`${table.depositFeeCents} is null or ${table.depositFeeCents} >= 0`),
    check("funds_archived_ck", sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`),
  ],
);

/**
 * A valuation of a fund (spec §7.7): its value is the `manual` balance entry it wrote on the
 * valuation account — one source (plan F4 §3.6.3) — and this row keeps what a balance has no place
 * for: units and a note. Deleting that balance entry takes the valuation with it.
 */
export const fundValuations = pgTable(
  "fund_valuations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    balanceEntryId: uuid("balance_entry_id")
      .notNull()
      .references(() => balanceEntries.id, { onDelete: "cascade" }),
    units: numeric("units", { precision: 18, scale: 6 }),
    note: text("note"),
    source: text("source", { enum: VALUATION_SOURCES }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_valuations_entry_uq").on(table.balanceEntryId),
    index("fund_valuations_fund_idx").on(table.fundId),
    check("fund_valuations_source_ck", sql`${table.source} in (${sql.raw(inList(VALUATION_SOURCES))})`),
    check("fund_valuations_units_ck", sql`${table.units} is null or ${table.units} >= 0`),
  ],
);

/**
 * A PAC deposit (spec §7.7): what was debited, the fee, and what was invested — computed, never
 * typed, and unknown while the fee is. A movement pays one deposit only.
 */
export const fundDeposits = pgTable(
  "fund_deposits",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    chargedCents: bigint("charged_cents", { mode: "bigint" }).notNull(),
    feeCents: bigint("fee_cents", { mode: "bigint" }),
    investedCents: bigint("invested_cents", { mode: "bigint" }).generatedAlwaysAs(
      sql`charged_cents - fee_cents`,
    ),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    source: text("source", { enum: DEPOSIT_SOURCES }).notNull().default("manual"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_deposits_transaction_uq").on(table.transactionId),
    index("fund_deposits_fund_on_idx").on(table.fundId, table.on),
    check("fund_deposits_source_ck", sql`${table.source} in (${sql.raw(inList(DEPOSIT_SOURCES))})`),
    check("fund_deposits_charged_ck", sql`${table.chargedCents} > 0`),
    check(
      "fund_deposits_fee_ck",
      sql`${table.feeCents} is null or (${table.feeCents} >= 0 and ${table.feeCents} <= ${table.chargedCents})`,
    ),
  ],
);

/** The movements that become deposits by themselves (spec §7.7): one rule per fund, switchable. */
export const fundDepositRules = pgTable(
  "fund_deposit_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    payeeMatch: text("payee_match").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "no action" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_deposit_rules_fund_uq").on(table.fundId),
    index("fund_deposit_rules_account_idx").on(table.accountId),
    check("fund_deposit_rules_match_ck", sql`length(btrim(${table.payeeMatch})) between 1 and 80`),
  ],
);
