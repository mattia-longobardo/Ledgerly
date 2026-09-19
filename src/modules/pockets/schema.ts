import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { accounts } from "../accounts/schema";
import { MOVEMENT_KINDS, POCKET_STATES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    backingAccountId: uuid("backing_account_id").references(() => accounts.id, { onDelete: "no action" }),
    targetCents: bigint("target_cents", { mode: "bigint" }),
    monthlyCents: bigint("monthly_cents", { mode: "bigint" }),
    startMonth: date("start_month").notNull(),
    state: text("state", { enum: POCKET_STATES }).notNull().default("active"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("pockets_user_name_uq").on(table.userId, table.name),
    index("pockets_backing_idx").on(table.backingAccountId),
    check("pockets_state_ck", sql`${table.state} in (${sql.raw(inList(POCKET_STATES))})`),
    check("pockets_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
    check("pockets_target_ck", sql`${table.targetCents} is null or ${table.targetCents} > 0`),
    check("pockets_monthly_ck", sql`${table.monthlyCents} is null or ${table.monthlyCents} > 0`),
    check("pockets_start_ck", sql`extract(day from ${table.startMonth}) = 1`),
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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    pocketId: uuid("pocket_id")
      .notNull()
      .references(() => pockets.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MOVEMENT_KINDS }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    on: date("on").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("pocket_movements_pocket_on_idx").on(table.pocketId, table.on),
    index("pocket_movements_user_idx").on(table.userId),
    uniqueIndex("pocket_movements_accrual_uq")
      .on(table.pocketId, table.on)
      .where(sql`${table.kind} = 'accrual'`),
    check("pocket_movements_kind_ck", sql`${table.kind} in (${sql.raw(inList(MOVEMENT_KINDS))})`),
    check(
      "pocket_movements_sign_ck",
      sql`case ${table.kind} when 'accrual' then ${table.amountCents} > 0 when 'deposit' then ${table.amountCents} > 0 when 'withdrawal' then ${table.amountCents} < 0 else ${table.amountCents} <> 0 end`,
    ),
    check(
      "pocket_movements_accrual_day_ck",
      sql`${table.kind} <> 'accrual' or extract(day from ${table.on}) = 1`,
    ),
    check(
      "pocket_movements_reason_ck",
      sql`${table.kind} not in ('withdrawal', 'adjustment') or length(btrim(coalesce(${table.reason}, ''))) between 1 and 200`,
    ),
  ],
);
