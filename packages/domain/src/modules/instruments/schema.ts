import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { inList } from "../../platform/db/checks";
import { INSTRUMENT_CLASSES } from "./rules";

/** A source of prices is a plugin: its id, never a provider's name in the code (M14). */
const SOURCE_ID = "'^[a-z][a-z0-9-]{1,30}$'";

// The registry of instruments (rewrite plan R5d): public reference data of the instance, so no
// `user_id`. A person reaches a row only through an asset of theirs or a search of their own.

/** A security: by ISIN when it has one, by its share class FIGI otherwise (a search by name). */
export const instruments = pgTable(
  "instruments",
  {
    id: idColumn(),
    isin: text("isin"),
    figi: text("figi"),
    name: text("name").notNull(),
    class: text("class", { enum: INSTRUMENT_CLASSES }).notNull(),
    cfi: text("cfi"),
    currency: text("currency").notNull(),
    resolvedAt: moment("resolved_at").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("instruments_isin_uq")
      .on(table.isin)
      .where(sql`${table.isin} is not null`),
    uniqueIndex("instruments_figi_uq")
      .on(table.figi)
      .where(sql`${table.figi} is not null`),
    check("instruments_key_ck", sql`${table.isin} is not null or ${table.figi} is not null`),
    check("instruments_isin_ck", sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`),
    check("instruments_name_ck", sql`length(btrim(${table.name})) between 1 and 200`),
    check("instruments_class_ck", sql`${table.class} in (${sql.raw(inList(INSTRUMENT_CLASSES))})`),
    check("instruments_cfi_ck", sql`${table.cfi} is null or ${table.cfi} ~ '^[A-Z]{6}$'`),
    check("instruments_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * A market an instrument trades on: its ticker there and its currency. `price_source` is the source
 * of the daily close, null when none has the market; `unpriced_reason` is the source's last «no».
 */
export const instrumentListings = pgTable(
  "instrument_listings",
  {
    id: idColumn(),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id, { onDelete: "cascade" }),
    mic: text("mic").notNull(),
    ticker: text("ticker"),
    currency: text("currency").notNull(),
    priceSource: text("price_source"),
    unpricedReason: text("unpriced_reason"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("instrument_listings_market_uq").on(table.instrumentId, table.mic),
    check("instrument_listings_mic_ck", sql`${table.mic} ~ '^[A-Z0-9]{4}$'`),
    check(
      "instrument_listings_ticker_ck",
      sql`${table.ticker} is null or length(btrim(${table.ticker})) between 1 and 20`,
    ),
    check("instrument_listings_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check(
      "instrument_listings_price_source_ck",
      sql`${table.priceSource} is null or ${table.priceSource} ~ ${sql.raw(SOURCE_ID)}`,
    ),
    check(
      "instrument_listings_reason_ck",
      sql`${table.unpricedReason} is null or length(${table.unpricedReason}) <= 40`,
    ),
  ],
);

/** One close a day of a market, by source. The source may correct a recent day: the row is updated. */
export const instrumentPrices = pgTable(
  "instrument_prices",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => instrumentListings.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    close: numeric("close", { precision: 30, scale: 12 }).notNull(),
    currency: text("currency").notNull(),
    source: text("source").notNull(),
    fetchedAt: moment("fetched_at").notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ name: "instrument_prices_pk", columns: [table.listingId, table.on, table.source] }),
    index("instrument_prices_last_idx").on(table.listingId, table.on.desc()),
    check("instrument_prices_close_ck", sql`${table.close} > 0`),
    check("instrument_prices_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("instrument_prices_source_ck", sql`${table.source} ~ ${sql.raw(SOURCE_ID)}`),
  ],
);
