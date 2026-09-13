import { sql } from "drizzle-orm";
import { boolean, check, integer, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";

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
    locale: text("locale", { enum: ["en", "it"] }).notNull(),
    numberFormat: text("number_format", { enum: ["it-IT", "en-US", "fr-FR"] }).notNull(),
    weekStart: smallint("week_start").notNull(),
    theme: text("theme", { enum: ["system", "light", "dark"] }).notNull(),
    defaultRange: text("default_range", { enum: ["this_month", "last_30_days", "year_to_date"] }).notNull(),
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
    check("user_preferences_locale_ck", sql`${table.locale} in ('en', 'it')`),
    check("user_preferences_number_format_ck", sql`${table.numberFormat} in ('it-IT', 'en-US', 'fr-FR')`),
    check("user_preferences_theme_ck", sql`${table.theme} in ('system', 'light', 'dark')`),
    check(
      "user_preferences_default_range_ck",
      sql`${table.defaultRange} in ('this_month', 'last_30_days', 'year_to_date')`,
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
