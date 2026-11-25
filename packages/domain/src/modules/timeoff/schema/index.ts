import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { users } from "../../../platform/auth/schema";
import { EXTERNAL_STATES, LEAVE_COLORS, LEAVE_UNITS, PENDING_STATES } from "../rules";
import { inList } from "../../../platform/db/checks";

/** The format of a word a type is known by outside: a payslip's balance, the calendar's kind. */
const WORD = "^[a-z][a-z0-9_-]{0,39}$";

/** Where a day came from: typed here, or read off the external calendar (R5c). */
export const LEAVE_ORIGINS = ["manual", "external"] as const;

/**
 * A type of leave (rewrite plan R5g, E6): data of the person, not a name in the code. The country
 * pack proposes the first ones; the person adds, renames and removes them.
 *
 * - `unit`: what one row of the type is — a whole day, a whole or a half day, or hours;
 * - `has_allowance`: the type has a yearly allowance, and so a residual;
 * - `to_calendar`: its days go to the external calendar;
 * - `balance_key`: the word a payslip prints its balance and its use under (payroll's vocabulary);
 * - `calendar_kind`: the word the external calendar holds its days under. The first type, by
 *   `position`, that has one gives the word every other type of the calendar goes across as.
 */
export const leaveTypes = pgTable(
  "leave_types",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color", { enum: LEAVE_COLORS }).notNull(),
    unit: text("unit", { enum: LEAVE_UNITS }).notNull(),
    hasAllowance: boolean("has_allowance").notNull(),
    toCalendar: boolean("to_calendar").notNull(),
    balanceKey: text("balance_key"),
    calendarKind: text("calendar_kind"),
    position: smallint("position").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("leave_types_user_name_uq").on(table.userId, table.name),
    index("leave_types_user_idx").on(table.userId, table.position),
    check("leave_types_name_ck", sql`length(${table.name}) between 1 and 40`),
    check("leave_types_color_ck", sql`${table.color} in (${sql.raw(inList(LEAVE_COLORS))})`),
    check("leave_types_unit_ck", sql`${table.unit} in (${sql.raw(inList(LEAVE_UNITS))})`),
    check(
      "leave_types_words_ck",
      sql`coalesce(${table.balanceKey} ~ ${sql.raw(`'${WORD}'`)}, true)
        and coalesce(${table.calendarKind} ~ ${sql.raw(`'${WORD}'`)}, true)`,
    ),
  ],
);

/**
 * What a year grants of one type, in days, and what the years before left over when no payslip
 * says it (decision 4 = A: a payslip's A.P. wins). A year with no row is a year nobody stated.
 */
export const leaveAllowances = pgTable(
  "leave_allowances",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    typeId: uuid("type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    days: numeric("days", { precision: 5, scale: 2 }),
    carriedDays: numeric("carried_days", { precision: 5, scale: 2 }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("leave_allowances_type_year_uq").on(table.userId, table.typeId, table.year),
    check("leave_allowances_year_ck", sql`${table.year} between 1990 and 2200`),
    check("leave_allowances_days_ck", sql`${table.days} is null or ${table.days} between 0 and 400`),
    check(
      "leave_allowances_carried_ck",
      sql`${table.carriedDays} is null or ${table.carriedDays} between -400 and 400`,
    ),
  ],
);

/** A day of the year the person does not work, every year (the patron saint, a town's feast). */
export const leaveRestDays = pgTable(
  "leave_rest_days",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: smallint("month").notNull(),
    day: smallint("day").notNull(),
    name: text("name").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("leave_rest_days_user_date_uq").on(table.userId, table.month, table.day),
    check("leave_rest_days_month_ck", sql`${table.month} between 1 and 12`),
    check("leave_rest_days_day_ck", sql`${table.day} between 1 and 31`),
    check("leave_rest_days_name_ck", sql`length(${table.name}) between 1 and 60`),
  ],
);

/**
 * The working week and the leave year of a person (E6). No row: Monday to Friday, from January.
 * `work_days` are the days of the week worked, 0 Sunday … 6 Saturday.
 */
export const leaveSettings = pgTable(
  "leave_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    yearStartMonth: smallint("year_start_month").notNull().default(1),
    workDays: smallint("work_days").array().notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    check("leave_settings_start_ck", sql`${table.yearStartMonth} between 1 and 12`),
    check(
      "leave_settings_days_ck",
      sql`cardinality(${table.workDays}) between 1 and 7 and ${table.workDays} <@ array[0,1,2,3,4,5,6]::smallint[]`,
    ),
  ],
);

/**
 * One day off of one type (spec §6, §7.9; types since R5g). Half a day of two types are two rows,
 * which is why the unique key carries the type. Whether a day is taken or planned is **not** a
 * column: it is `on` against the payslips and today (plan F7 §3.4.3, R5g decision 3 = A).
 *
 * Where a row came from (`origin`): there is no `payroll` — leave read off a payslip is monthly,
 * and inventing a date for it would make up a fact the payslip does not state (plan F7 §3.6.1).
 *
 * `pending` is what the next pass of the calendar owes this row, and the observed pair is the last
 * state the calendar was **observed** in. Its api can be a toggle — sending the same pair again
 * removes the day — so a deletion has to name what the calendar actually holds (plan F7 §3.4.8).
 */
export const leaveDays = pgTable(
  "leave_days",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    typeId: uuid("type_id")
      .notNull()
      .references(() => leaveTypes.id, { onDelete: "restrict" }),
    /** Half a day or a whole one; for a type counted in hours, the nearest of the two. */
    fraction: numeric("fraction", { precision: 2, scale: 1 }).notNull(),
    /** The length of a row of a type counted in hours; null for the others. */
    minutes: smallint("minutes"),
    note: text("note"),
    origin: text("origin", { enum: LEAVE_ORIGINS }).notNull().default("manual"),
    pending: text("pending", { enum: PENDING_STATES }).notNull().default("none"),
    syncedAt: moment("synced_at"),
    /**
     * The observed pair in the words of contract 2 (rewrite plan R5c), the one read since R5g. The
     * kind is the calendar's own word, an open vocabulary: its check is a format (rule M13).
     */
    externalKind: text("external_kind"),
    externalFraction: numeric("external_fraction", { precision: 2, scale: 1 }),
    externalState: text("external_state", { enum: EXTERNAL_STATES }),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("leave_days_user_on_type_uq").on(table.userId, table.on, table.typeId),
    index("leave_days_type_idx").on(table.typeId),
    index("leave_days_user_on_idx").on(table.userId, table.on),
    index("leave_days_pending_idx")
      .on(table.userId, table.on)
      .where(sql`${table.pending} <> 'none'`),
    check("leave_days_origin_ck", sql`${table.origin} in (${sql.raw(inList(LEAVE_ORIGINS))})`),
    check("leave_days_pending_ck", sql`${table.pending} in (${sql.raw(inList(PENDING_STATES))})`),
    // A day off is half a day or a whole one (N0); a row in hours keeps the nearest of the two.
    check("leave_days_fraction_value_ck", sql`${table.fraction} in (0.5, 1.0)`),
    check("leave_days_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
    check("leave_days_minutes_ck", sql`${table.minutes} is null or ${table.minutes} between 1 and 1440`),
    // Nobody asks the calendar to delete a day it never had: a pending deletion needs a row it either
    // gave us or has already been told about (plan F7 §3.2).
    check(
      "leave_days_pending_delete_ck",
      sql`${table.pending} <> 'delete' or ${table.origin} <> 'manual' or ${table.syncedAt} is not null`,
    ),
    // The pair of contract 2 and its state, in one check: the kind by its format (M13), the
    // fraction one of the two sizes, the state one of the core's own words.
    check(
      "leave_days_external_ck",
      sql`coalesce(${table.externalKind} ~ '^[a-z][a-z0-9_-]{0,39}$', true)
        and coalesce(${table.externalFraction} in (0.5, 1.0), true)
        and coalesce(${table.externalState} in (${sql.raw(inList(EXTERNAL_STATES))}), true)`,
    ),
  ],
);
