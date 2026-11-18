import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { inList } from "../../platform/db/checks";
import { users } from "../../platform/auth/schema";
import {
  CURRENCY_POSITIONS,
  DECIMAL_SEPARATORS,
  DEFAULT_RANGES,
  LOCALES,
  NUMBER_FORMATS,
  THEMES,
} from "./rules";

export const userPreferences = pgTable(
  "user_preferences",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .unique()
      .references(() => users.id, { onDelete: "cascade" }),
    timeZone: text("time_zone").notNull(),
    locale: text("locale", { enum: LOCALES }).notNull(),
    numberFormat: text("number_format", { enum: NUMBER_FORMATS }).notNull(),
    // Null on both: follow whatever the chosen number format does, which is how every row written
    // before these two settings existed keeps formatting exactly as it did.
    decimalSeparator: text("decimal_separator", { enum: DECIMAL_SEPARATORS }),
    currencyPosition: text("currency_position", { enum: CURRENCY_POSITIONS }),
    // What every total across accounts is shown in (docs/design/investments.md §1.8, D1). Each
    // account keeps its own currency; a total converts at read time, so this never rewrites a balance.
    displayCurrency: text("display_currency").notNull().default("EUR"),
    weekStart: smallint("week_start").notNull(),
    theme: text("theme", { enum: THEMES }).notNull(),
    defaultRange: text("default_range", { enum: DEFAULT_RANGES }).notNull(),
    monthlySummary: boolean("monthly_summary").notNull(),
    minutesPerDay: integer("minutes_per_day").notNull(),
    patronMonth: smallint("patron_month"),
    patronDay: smallint("patron_day"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check("user_preferences_week_start_ck", sql`${table.weekStart} in (0, 1)`),
    check("user_preferences_minutes_ck", sql`${table.minutesPerDay} between 60 and 720`),
    check("user_preferences_patron_ck", sql`(${table.patronMonth} is null) = (${table.patronDay} is null)`),
    check("user_preferences_locale_ck", sql`${table.locale} in (${sql.raw(inList(LOCALES))})`),
    check(
      "user_preferences_number_format_ck",
      sql`${table.numberFormat} in (${sql.raw(inList(NUMBER_FORMATS))})`,
    ),
    check(
      "user_preferences_decimal_separator_ck",
      sql`${table.decimalSeparator} is null or ${table.decimalSeparator} in (${sql.raw(inList(DECIMAL_SEPARATORS))})`,
    ),
    check(
      "user_preferences_currency_position_ck",
      sql`${table.currencyPosition} is null or ${table.currencyPosition} in (${sql.raw(inList(CURRENCY_POSITIONS))})`,
    ),
    check("user_preferences_display_currency_ck", sql`${table.displayCurrency} ~ '^[A-Z]{3}$'`),
    check("user_preferences_theme_ck", sql`${table.theme} in (${sql.raw(inList(THEMES))})`),
    check(
      "user_preferences_default_range_ck",
      sql`${table.defaultRange} in (${sql.raw(inList(DEFAULT_RANGES))})`,
    ),
    check(
      "user_preferences_patron_month_ck",
      sql`${table.patronMonth} is null or ${table.patronMonth} between 1 and 12`,
    ),
    check(
      "user_preferences_patron_day_ck",
      sql`${table.patronDay} is null or ${table.patronDay} between 1 and 31`,
    ),
  ],
);
