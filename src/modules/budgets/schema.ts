import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { accounts } from "../accounts/schema";
import { categories } from "../transactions/schema";

/**
 * A monthly spending limit (spec §6, §7.3) on a category, an account or both (F3), versioned by
 * month: the limit of a scope in month M is the row with the latest `from_month` ≤ M. Changing a limit writes a new
 * version from the month on screen onwards; taking the budget away from a month on is a version
 * too, marked `stopped` — a `null` amount here would not mean "unknown" (spec §4.3), so the column
 * says it outright.
 *
 * `on delete cascade` on the category only serves the deletion of a user: a category is archived,
 * never deleted (spec §7.2).
 */
export const budgetLimits = pgTable(
  "budget_limits",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "cascade" }),
    /**
     * F3: a budget may be on an account instead of, or as well as, a category. `on delete no
     * action`, like pockets and subscriptions: an account a budget points at is archived instead.
     */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "no action" }),
    fromMonth: date("from_month").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }),
    stopped: boolean("stopped").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("budget_limits_scope_month_uq")
      .on(table.userId, table.categoryId, table.accountId, table.fromMonth)
      .nullsNotDistinct(),
    check("budget_limits_scope_ck", sql`${table.categoryId} is not null or ${table.accountId} is not null`),
    index("budget_limits_user_month_idx").on(table.userId, table.fromMonth),
    check("budget_limits_month_ck", sql`extract(day from ${table.fromMonth}) = 1`),
    check(
      "budget_limits_amount_ck",
      sql`(${table.stopped} and ${table.amountCents} is null) or (not ${table.stopped} and ${table.amountCents} > 0)`,
    ),
  ],
);
