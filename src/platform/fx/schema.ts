import { sql } from "drizzle-orm";
import { check, date, numeric, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { FX_SOURCES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * One ECB reference rate (docs/design/investments.md §1.8): what one unit of `currency` was worth
 * in euro on `on`. Market data, so no `user_id`. Base is always EUR, and EUR itself has no row
 * (it is 1). A day without a fixing (a weekend, a holiday) has no row: a reader takes the last
 * rate on or before it.
 *
 * Rows are immutable: a value used once never changes, so a later fetch only adds days.
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    on: date("on").notNull(),
    currency: text("currency").notNull(),
    eurPerUnit: numeric("eur_per_unit", { precision: 20, scale: 10 }).notNull(),
    source: text("source", { enum: FX_SOURCES }).notNull().default("ecb"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "fx_rates_pk", columns: [table.on, table.currency] }),
    check("fx_rates_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("fx_rates_eur_per_unit_ck", sql`${table.eurPerUnit} > 0`),
    check("fx_rates_source_ck", sql`${table.source} in (${sql.raw(inList(FX_SOURCES))})`),
  ],
);
