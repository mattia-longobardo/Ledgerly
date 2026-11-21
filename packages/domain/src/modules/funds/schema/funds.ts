// Funds · the tables of the fund, its valuations and what release N6 left of the deposits (history).
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
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { accounts, balanceEntries } from "../../accounts/schema";
import { transactions } from "../../transactions/schema";
import { FUND_STATES, VALUATION_SOURCES } from "../rules";

const LEGACY_FUND_TYPES = ["pac", "pension"] as const;
const LEGACY_DEPOSIT_SOURCES = ["manual", "rule"] as const;
export const LEGACY_RULE_KINDS = ["contribution", "payment_schedule"] as const;

/**
 * A pension fund: its name, who runs it, and the account that holds its value, so net worth has one
 * source. Where the money comes from is in `fund_contribution_sources`, what it costs in `fund_fees`.
 *
 * `type`, `isin`, `debit_account_id`, `debit_day`, `ter`, `monthly_cents`, `deposit_fee_cents` and
 * `receives_payroll` are of the model before N6: nothing reads or writes them, and R5f removes them.
 */
export const funds = pgTable(
  "funds",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: LEGACY_FUND_TYPES }).notNull().default("pension"),
    provider: text("provider"),
    isin: text("isin"),
    /** The fund's or the position's identifier, as the person writes it. */
    code: text("code"),
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
    /** The pension fund the payslips' competences go to (plan F6 §3.6.2): one per person. */
    receivesPayroll: boolean("receives_payroll").notNull().default(false),
    archivedAt: moment("archived_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("funds_valuation_account_uq").on(table.valuationAccountId),
    unique("funds_user_name_uq").on(table.userId, table.name),
    index("funds_debit_account_idx").on(table.debitAccountId),
    check("funds_type_ck", sql`${table.type} in (${sql.raw(inList(LEGACY_FUND_TYPES))})`),
    check("funds_state_ck", sql`${table.state} in (${sql.raw(inList(FUND_STATES))})`),
    check("funds_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("funds_code_ck", sql`${table.code} is null or length(${table.code}) <= 40`),
    check("funds_isin_ck", sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`),
    check("funds_debit_day_ck", sql`${table.debitDay} is null or ${table.debitDay} between 1 and 31`),
    check("funds_ter_ck", sql`${table.ter} is null or ${table.ter} between 0 and 1`),
    check("funds_monthly_ck", sql`${table.monthlyCents} is null or ${table.monthlyCents} > 0`),
    check("funds_fee_ck", sql`${table.depositFeeCents} is null or ${table.depositFeeCents} >= 0`),
    check("funds_archived_ck", sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`),
    check("funds_receives_payroll_ck", sql`not ${table.receivesPayroll} or ${table.type} = 'pension'`),
    uniqueIndex("funds_receives_payroll_uq")
      .on(table.userId)
      .where(sql`${table.receivesPayroll}`),
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("fund_valuations_entry_uq").on(table.balanceEntryId),
    index("fund_valuations_fund_idx").on(table.fundId),
    check("fund_valuations_source_ck", sql`${table.source} in (${sql.raw(inList(VALUATION_SOURCES))})`),
    check("fund_valuations_units_ck", sql`${table.units} is null or ${table.units} >= 0`),
  ],
);

/** Before N6: a deposit of a fund with a debit plan. Now a `voluntary` operation. Not read; removed in R5f. */
export const fundDeposits = pgTable(
  "fund_deposits",
  {
    id: idColumn(),
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
    source: text("source", { enum: LEGACY_DEPOSIT_SOURCES }).notNull().default("manual"),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("fund_deposits_transaction_uq").on(table.transactionId),
    index("fund_deposits_fund_on_idx").on(table.fundId, table.on),
    check("fund_deposits_source_ck", sql`${table.source} in (${sql.raw(inList(LEGACY_DEPOSIT_SOURCES))})`),
    check("fund_deposits_charged_ck", sql`${table.chargedCents} > 0`),
    check(
      "fund_deposits_fee_ck",
      sql`${table.feeCents} is null or (${table.feeCents} >= 0 and ${table.feeCents} <= ${table.chargedCents})`,
    ),
  ],
);

/** Before N6: the rule of a fund's debit. Now a `bank_debit` source. Not read; removed in R5f. */
export const fundDepositRules = pgTable(
  "fund_deposit_rules",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    payeeMatch: text("payee_match").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "no action" }),
    active: boolean("active").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("fund_deposit_rules_fund_uq").on(table.fundId),
    index("fund_deposit_rules_account_idx").on(table.accountId),
    check("fund_deposit_rules_match_ck", sql`length(btrim(${table.payeeMatch})) between 1 and 80`),
  ],
);
