import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { users } from "../../platform/auth/schema";
import { accounts } from "../accounts/schema";
import { transactions } from "../transactions/schema";
import { POCKET_STATES, STORED_MOVEMENT_KINDS } from "./rules";
import { inList } from "../../platform/db/checks";

/**
 * A virtual envelope (spec §6, §7.4): money earmarked without moving it. The backing account is
 * optional (a standalone envelope), and so are the target and the monthly accrual — `null` accrual
 * is the design's "Manually".
 *
 * `on delete no action` on the account (checked at the end of the statement, so deleting a user still cascades): an account something rests on is archived, not deleted
 * (spec §7.1), and the refusal is how `removeAccount` learns it without reading this table.
 */
export const pockets = pgTable(
  "pockets",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    backingAccountId: uuid("backing_account_id").references(() => accounts.id, { onDelete: "no action" }),
    targetCents: bigint("target_cents", { mode: "bigint" }),
    monthlyCents: bigint("monthly_cents", { mode: "bigint" }),
    startMonth: date("start_month").notNull(),
    // The day of the month the accrual lands on (R5a, D6): 1 to 31, the last day of a shorter month.
    accrualDay: smallint("accrual_day").notNull().default(1),
    state: text("state", { enum: POCKET_STATES }).notNull().default("active"),
    archivedAt: moment("archived_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("pockets_user_name_uq").on(table.userId, table.name),
    index("pockets_backing_idx").on(table.backingAccountId),
    check("pockets_state_ck", sql`${table.state} in (${sql.raw(inList(POCKET_STATES))})`),
    check("pockets_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
    check("pockets_target_ck", sql`${table.targetCents} is null or ${table.targetCents} > 0`),
    check("pockets_monthly_ck", sql`${table.monthlyCents} is null or ${table.monthlyCents} > 0`),
    check("pockets_start_ck", sql`extract(day from ${table.startMonth}) = 1`),
    check("pockets_accrual_day_ck", sql`${table.accrualDay} between 1 and 31`),
    check("pockets_archived_ck", sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`),
  ],
);

/**
 * What moves a pocket's balance (spec §6, §7.4): the balance is their sum. One `accrual` per
 * pocket and month, enforced here — the monthly job's idempotency is the database's, not a read
 * before a write.
 */
export const pocketMovements = pgTable(
  "pocket_movements",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pocketId: uuid("pocket_id")
      .notNull()
      .references(() => pockets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: STORED_MOVEMENT_KINDS }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    on: date("on").notNull(),
    reason: text("reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("pocket_movements_pocket_on_idx").on(table.pocketId, table.on),
    index("pocket_movements_user_idx").on(table.userId),
    // Kept for the image before R5a, which names it in its `ON CONFLICT`.
    uniqueIndex("pocket_movements_accrual_uq")
      .on(table.pocketId, table.on)
      .where(sql`${table.kind} = 'accrual'`),
    // One accrual per pocket and month, on the pocket's day (R5a, D6).
    uniqueIndex("pocket_movements_accrual_month_uq")
      .on(table.pocketId, sql`date_trunc('month', ${table.on}::timestamp)`)
      .where(sql`${table.kind} = 'accrual'`),
    check("pocket_movements_kind_ck", sql`${table.kind} in (${sql.raw(inList(STORED_MOVEMENT_KINDS))})`),
    check(
      "pocket_movements_sign_ck",
      sql`case ${table.kind} when 'accrual' then ${table.amountCents} > 0 when 'deposit' then ${table.amountCents} > 0 when 'withdrawal' then ${table.amountCents} < 0 else ${table.amountCents} <> 0 end`,
    ),
    // Wider since R5a (D6): an accrual lands on the pocket's day, any day of its month.
    check(
      "pocket_movements_accrual_day_ck",
      sql`${table.kind} <> 'accrual' or extract(day from ${table.on}) between 1 and 31`,
    ),
    check(
      "pocket_movements_reason_ck",
      sql`${table.kind} not in ('withdrawal', 'adjustment') or length(btrim(coalesce(${table.reason}, ''))) between 1 and 200`,
    ),
  ],
);

/**
 * An expense filed under a standalone pocket by hand. A pocket on an account needs none: every
 * expense of its account counts already. One pocket per expense, enforced here; the link goes with
 * the movement when the movement goes.
 */
export const pocketExpenseLinks = pgTable(
  "pocket_expense_links",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pocketId: uuid("pocket_id")
      .notNull()
      .references(() => pockets.id, { onDelete: "cascade" }),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("pocket_expense_links_transaction_uq").on(table.transactionId),
    index("pocket_expense_links_pocket_idx").on(table.pocketId),
    index("pocket_expense_links_user_idx").on(table.userId),
  ],
);

/**
 * An expense the person expects to make from a pocket, on the day they expect it. Nothing moves:
 * it only shows what would be left. It stays a week past its day, then the daily job drops it.
 */
export const pocketPlannedExpenses = pgTable(
  "pocket_planned_expenses",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pocketId: uuid("pocket_id")
      .notNull()
      .references(() => pockets.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    dueOn: date("due_on").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("pocket_planned_expenses_pocket_due_idx").on(table.pocketId, table.dueOn),
    index("pocket_planned_expenses_user_idx").on(table.userId),
    check("pocket_planned_expenses_amount_ck", sql`${table.amountCents} > 0`),
    check(
      "pocket_planned_expenses_description_ck",
      sql`length(btrim(${table.description})) between 1 and 200`,
    ),
  ],
);
