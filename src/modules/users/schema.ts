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
  ],
);
