import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, smallint, text, uuid } from "drizzle-orm/pg-core";
import { checkIn, createdAtColumn, idColumn, updatedAtColumn } from "../../platform/db/columns";
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check("user_preferences_week_start_ck", sql`${table.weekStart} in (0, 1)`),
    check("user_preferences_minutes_ck", sql`${table.minutesPerDay} between 60 and 720`),
    check("user_preferences_patron_ck", sql`(${table.patronMonth} is null) = (${table.patronDay} is null)`),
    checkIn("user_preferences_locale_ck", table.locale, LOCALES),
    checkIn("user_preferences_number_format_ck", table.numberFormat, NUMBER_FORMATS),
    checkIn("user_preferences_decimal_separator_ck", table.decimalSeparator, DECIMAL_SEPARATORS, true),
    checkIn("user_preferences_currency_position_ck", table.currencyPosition, CURRENCY_POSITIONS, true),
    check("user_preferences_display_currency_ck", sql`${table.displayCurrency} ~ '^[A-Z]{3}$'`),
    checkIn("user_preferences_theme_ck", table.theme, THEMES),
    checkIn("user_preferences_default_range_ck", table.defaultRange, DEFAULT_RANGES),
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
