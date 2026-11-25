// Funds · the tables of the fund and its valuations.
import { sql } from "drizzle-orm";
import { check, date, index, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { accounts, balanceEntries } from "../../accounts/schema";
import { FUND_STATES, VALUATION_SOURCES } from "../rules";

/**
 * A pension fund: its name, who runs it, and the account that holds its value, so net worth has one
 * source. Where the money comes from is in `fund_contribution_sources`, what it costs in `fund_fees`.

 */
export const funds = pgTable(
  "funds",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    provider: text("provider"),
    /** The fund's or the position's identifier, as the person writes it. */
    code: text("code"),
    compartment: text("compartment"),
    valuationAccountId: uuid("valuation_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    startOn: date("start_on").notNull(),
    state: text("state", { enum: FUND_STATES }).notNull().default("active"),
    archivedAt: moment("archived_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("funds_valuation_account_uq").on(table.valuationAccountId),
    unique("funds_user_name_uq").on(table.userId, table.name),
    check("funds_state_ck", sql`${table.state} in (${sql.raw(inList(FUND_STATES))})`),
    check("funds_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("funds_code_ck", sql`${table.code} is null or length(${table.code}) <= 40`),
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
