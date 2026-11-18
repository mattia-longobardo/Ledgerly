import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../auth/schema";
import { HOLIDAY_SOURCES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A public-holiday calendar a person has subscribed to (M3): a country, and as much of a place
 * inside it as the source can name. More than one is the point — somebody who works across two
 * countries, or who wants the town they are from as well as the one they live in.
 *
 * The rows are a *subscription*, not the holidays: the days themselves live in `holiday_days` and
 * are fetched from the source, because a public holiday is somebody else's fact and it moves.
 */
export const holidayCalendars = pgTable(
  "holiday_calendars",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", { enum: HOLIDAY_SOURCES }).notNull(),
    /** ISO 3166-1 alpha-2, upper case. */
    country: text("country").notNull(),
    /** The source's own code for the place inside the country; `null` for the whole country. */
    subdivision: text("subdivision"),
    /** What to call it on screen, in the language it was picked in. */
    label: text("label").notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One subscription per place: `coalesce` because two nulls are not equal to each other, and
    // without it "the whole of Italy" could be subscribed to any number of times.
    uniqueIndex("holiday_calendars_place_uq").on(
      table.userId,
      table.source,
      table.country,
      sql`coalesce(${table.subdivision}, '')`,
    ),
    check("holiday_calendars_source_ck", sql`${table.source} in (${sql.raw(inList(HOLIDAY_SOURCES))})`),
    check("holiday_calendars_country_ck", sql`${table.country} ~ '^[A-Z]{2}$'`),
    check(
      "holiday_calendars_subdivision_ck",
      sql`${table.subdivision} is null or length(${table.subdivision}) between 2 and 20`,
    ),
    check("holiday_calendars_label_ck", sql`length(btrim(${table.label})) between 1 and 120`),
  ],
);

/**
 * One public holiday of one calendar, as its source last reported it. Cached rather than computed:
 * these are somebody else's dates — a moved bank holiday, a new national day — and the only honest
 * way to have them right is to ask again (M3: "aggiornati online").
 *
 * `year` is stored beside the date so a refresh can replace exactly one year of one calendar
 * without a range predicate, which is what makes the job's write idempotent.
 */
export const holidayDays = pgTable(
  "holiday_days",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    calendarId: uuid("calendar_id")
      .notNull()
      .references(() => holidayCalendars.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    year: smallint("year").notNull(),
    name: text("name").notNull(),
    /** Whether the source calls it national; a local one is the interesting case. */
    nationwide: boolean("nationwide").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("holiday_days_entry_uq").on(table.calendarId, table.on, table.name),
    index("holiday_days_user_on_idx").on(table.userId, table.on),
    index("holiday_days_calendar_year_idx").on(table.calendarId, table.year),
    check("holiday_days_year_ck", sql`${table.year} = extract(year from ${table.on})`),
    check("holiday_days_name_ck", sql`length(btrim(${table.name})) between 1 and 200`),
  ],
);
