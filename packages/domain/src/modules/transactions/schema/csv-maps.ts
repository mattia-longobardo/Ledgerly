import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, updatedAtColumn } from "../../../platform/db/columns";
import { accounts } from "../../accounts/schema";
import { users } from "../../../platform/auth/schema";

/** The places of the columns of a CSV file: the part of the map that is a JSON value. */
export interface CsvColumns {
  date: number;
  amount: number | null;
  debit: number | null;
  credit: number | null;
  payee: number | null;
  note: number | null;
  category: number | null;
}

/**
 * The map of the columns of a CSV file, one per account «a mano» (decision ST-8): the next file of
 * the same bank opens with it. The shape is the contract's `csvMapSchema`; the checks here are of
 * form only (rule M13). Deleting the account takes its map with it.
 */
export const csvColumnMaps = pgTable(
  "csv_column_maps",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    map: jsonb("map").$type<CsvColumns>().notNull(),
    delimiter: text("delimiter").notNull(),
    decimalSeparator: text("decimal_separator").notNull(),
    dateFormat: text("date_format").notNull(),
    skipRows: integer("skip_rows").notNull().default(0),
    header: boolean("header").notNull().default(true),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("csv_column_maps_user_idx").on(table.userId),
    check("csv_column_maps_delimiter_ck", sql`char_length(${table.delimiter}) = 1`),
    check("csv_column_maps_decimal_ck", sql`char_length(${table.decimalSeparator}) = 1`),
    check("csv_column_maps_skip_ck", sql`${table.skipRows} >= 0`),
  ],
);
