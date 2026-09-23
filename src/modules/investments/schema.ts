import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { transactions } from "../transactions/schema";
import { MOVEMENT_KINDS } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A trading platform the person keeps money on (Binance, eToro, …), with the address of its site so
 * the page can send them there. Deleting one deletes its history with it: it is the person's own
 * record, and the page asks first.
 */
export const investmentPlatforms = pgTable(
  "investment_platforms",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("investment_platforms_user_name_uq").on(table.userId, table.name),
    check("investment_platforms_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
    check(
      "investment_platforms_url_ck",
      sql`${table.url} is null or (${table.url} ~ '^https?://' and length(${table.url}) <= 500)`,
    ),
  ],
);

/**
 * Money that went into a platform or came out of it. The amount is positive; the kind gives the
 * direction. `transaction_id` optionally points at the bank movement that paid it or received it:
 * a note of provenance that moves no balance, and one bank movement documents one platform movement
 * at most. `sheet_key` is the row of the owner's spreadsheet it was imported from, so importing the
 * same file twice adds nothing.
 */
export const investmentMovements = pgTable(
  "investment_movements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => investmentPlatforms.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: MOVEMENT_KINDS }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    on: date("on").notNull(),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    note: text("note"),
    sheetKey: text("sheet_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("investment_movements_user_on_idx").on(table.userId, table.on),
    index("investment_movements_platform_idx").on(table.platformId),
    unique("investment_movements_transaction_uq").on(table.transactionId),
    unique("investment_movements_sheet_uq").on(table.userId, table.sheetKey),
    check("investment_movements_kind_ck", sql`${table.kind} in (${sql.raw(inList(MOVEMENT_KINDS))})`),
    check("investment_movements_amount_ck", sql`${table.amountCents} > 0`),
    check(
      "investment_movements_note_ck",
      sql`${table.note} is null or length(btrim(${table.note})) between 1 and 200`,
    ),
  ],
);

/** What a platform was worth at the end of a day, as read on the platform. One per platform and day. */
export const investmentValuations = pgTable(
  "investment_valuations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => investmentPlatforms.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    valueCents: bigint("value_cents", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("investment_valuations_platform_on_uq").on(table.platformId, table.on),
    index("investment_valuations_user_idx").on(table.userId),
    check("investment_valuations_value_ck", sql`${table.valueCents} >= 0`),
  ],
);
