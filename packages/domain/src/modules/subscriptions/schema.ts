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
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { users } from "../../platform/auth/schema";
import { accounts } from "../accounts/schema";
import { categories, transactions } from "../transactions/schema";
import { CHARGE_STATES, CYCLES, EVERY_UNITS, MAX_EVERY, SUBSCRIPTION_STATES } from "./rules";
import { inList } from "../../platform/db/checks";

/**
 * A recurring charge entered by hand (spec §6, §7.5). `next_charge_on` is the date of one charge,
 * as the person said it: the anchor of the charge calendar, from which "next charge" is derived
 * (a stored "next" would be stale the day after).
 *
 * `on delete no action` on the paying account, as for pockets: the account is archived instead.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    // Null since R5a: no vote (ST-15); the votes of before stay as they are.
    utility: smallint("utility").default(5),
    priceCents: bigint("price_cents", { mode: "bigint" }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    cycle: text("cycle", { enum: CYCLES }).notNull(),
    // «Every N weeks or months» (R5a, ST-15, D4): set only for a frequency that is none of the 4
    // cycles; `cycle` then holds the nearest one, so an image before R5a still reads a cycle it knows.
    everyUnit: text("every_unit", { enum: EVERY_UNITS }),
    everyCount: smallint("every_count"),
    nextChargeOn: date("next_charge_on").notNull(),
    paymentAccountId: uuid("payment_account_id").references(() => accounts.id, { onDelete: "no action" }),
    payeeMatch: text("payee_match"),
    tolerance: numeric("tolerance", { precision: 10, scale: 6 }).notNull().default("0.05"),
    state: text("state", { enum: SUBSCRIPTION_STATES }).notNull().default("active"),
    cancelledAt: moment("cancelled_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("subscriptions_user_idx").on(table.userId, table.name, table.id),
    index("subscriptions_account_idx").on(table.paymentAccountId),
    check("subscriptions_cycle_ck", sql`${table.cycle} in (${sql.raw(inList(CYCLES))})`),
    check("subscriptions_state_ck", sql`${table.state} in (${sql.raw(inList(SUBSCRIPTION_STATES))})`),
    check("subscriptions_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("subscriptions_utility_ck", sql`${table.utility} is null or ${table.utility} between 1 and 10`),
    check(
      "subscriptions_every_ck",
      sql`(${table.everyUnit} is null and ${table.everyCount} is null) or (${table.everyUnit} = 'week' and ${table.everyCount} between 1 and ${sql.raw(String(MAX_EVERY.week))}) or (${table.everyUnit} = 'month' and ${table.everyCount} between 1 and ${sql.raw(String(MAX_EVERY.month))})`,
    ),
    check("subscriptions_price_ck", sql`${table.priceCents} > 0`),
    check("subscriptions_currency_ck", sql`${table.currency} = 'EUR'`),
    check("subscriptions_tolerance_ck", sql`${table.tolerance} between 0 and 1`),
    check(
      "subscriptions_match_ck",
      sql`${table.payeeMatch} is null or length(btrim(${table.payeeMatch})) between 1 and 80`,
    ),
    check(
      "subscriptions_cancelled_ck",
      sql`(${table.state} = 'cancelled') = (${table.cancelledAt} is not null)`,
    ),
  ],
);

/**
 * The payment check of one expected charge (spec §7.5). A movement pays at most one charge, across
 * subscriptions, so two plans matching the same payee cannot both claim it. `expected_cents` is
 * fixed when the row is first written; the state is recomputed on every pass.
 */
export const subscriptionCharges = pgTable(
  "subscription_charges",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subscriptionId: uuid("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "cascade" }),
    dueOn: date("due_on").notNull(),
    periodFrom: date("period_from").notNull(),
    periodTo: date("period_to").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    expectedCents: bigint("expected_cents", { mode: "bigint" }).notNull(),
    actualCents: bigint("actual_cents", { mode: "bigint" }),
    state: text("state", { enum: CHARGE_STATES }).notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("subscription_charges_due_uq").on(table.subscriptionId, table.dueOn),
    unique("subscription_charges_transaction_uq").on(table.transactionId),
    index("subscription_charges_sub_due_idx").on(table.subscriptionId, table.dueOn.desc()),
    index("subscription_charges_user_idx").on(table.userId),
    check("subscription_charges_state_ck", sql`${table.state} in (${sql.raw(inList(CHARGE_STATES))})`),
    check(
      "subscription_charges_period_ck",
      sql`${table.periodFrom} <= ${table.dueOn} and ${table.dueOn} <= ${table.periodTo}`,
    ),
    check("subscription_charges_expected_ck", sql`${table.expectedCents} > 0`),
    check(
      "subscription_charges_actual_ck",
      sql`(${table.state} in ('paid', 'amount_differs')) = (${table.actualCents} is not null)`,
    ),
  ],
);
