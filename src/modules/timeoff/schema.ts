import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { LEAVE_DAY_KINDS, LEAVE_ORIGINS, PENDING_STATES, TREK_KINDS } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * What a year grants (spec §6, §7.9): days of vacation and days of ROL. One row per year — a year
 * with no row is not a year with no leave, it is a year whose allowance nobody has stated, and the
 * residual says so rather than guessing (plan F7 §3.4.13).
 *
 * What the years before left over is **not** here (N9). The payslip prints it as A.P., which makes
 * it the employer's figure; asking for it again here only created a second answer to one question.
 */
export const timeoffAllowances = pgTable(
  "timeoff_allowances",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    vacationDays: numeric("vacation_days", { precision: 5, scale: 2 }),
    /** ROL in days as well since N9: the unit the whole screen counts in. */
    rolDays: numeric("rol_days", { precision: 5, scale: 2 }),
    /**
     * The days a year grants altogether — vacation and ROL together, as a contract usually puts it
     * (N7). Kept beside the two parts rather than derived from them: it is the figure the employer
     * states, and when it and the parts disagree the screen says so instead of quietly picking one.
     */
    totalDays: numeric("total_days", { precision: 5, scale: 2 }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("timeoff_allowances_user_year_uq").on(table.userId, table.year),
    check("timeoff_allowances_year_ck", sql`${table.year} between 1990 and 2200`),
    check(
      "timeoff_allowances_vacation_ck",
      sql`${table.vacationDays} is null or ${table.vacationDays} between 0 and 400`,
    ),
    check("timeoff_allowances_rol_ck", sql`${table.rolDays} is null or ${table.rolDays} between 0 and 400`),
    check(
      "timeoff_allowances_total_ck",
      sql`${table.totalDays} is null or ${table.totalDays} between 0 and 400`,
    ),
    check("timeoff_allowances_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
  ],
);

/**
 * One day off, one kind (spec §6, §7.9). Half a day of vacation and half a day of ROL are two
 * rows, which is why the unique key carries the kind. Every kind is counted the same way — half a
 * day or a whole one — since N0: ROL used to be free-form minutes, and nobody books leave by the
 * minute.
 *
 * Whether a day is taken or planned is **not** a column: it is `on` against today, and it changes
 * by itself at midnight (plan F7 §3.4.3).
 *
 * `pending` is what the next Trek pass owes this row, and `trek_fraction`/`trek_kind` are the last
 * state Trek was **observed** in. Trek's api is a toggle — sending the same pair again removes the
 * day — so a deletion has to name what Trek actually holds, not what we wanted it to hold; without
 * the observed pair a delete can recreate the very day it meant to remove (plan F7 §3.4.8).
 */
export const leaveDays = pgTable(
  "leave_days",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    kind: text("kind", { enum: LEAVE_DAY_KINDS }).notNull(),
    /** Half a day or a whole one — every kind, ROL included since N0. */
    fraction: numeric("fraction", { precision: 2, scale: 1 }).notNull(),
    note: text("note"),
    origin: text("origin", { enum: LEAVE_ORIGINS }).notNull().default("manual"),
    pending: text("pending", { enum: PENDING_STATES }).notNull().default("none"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    trekFraction: numeric("trek_fraction", { precision: 2, scale: 1 }),
    trekKind: text("trek_kind", { enum: TREK_KINDS }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("leave_days_user_on_kind_uq").on(table.userId, table.on, table.kind),
    index("leave_days_user_on_idx").on(table.userId, table.on),
    index("leave_days_pending_idx")
      .on(table.userId, table.on)
      .where(sql`${table.pending} <> 'none'`),
    check("leave_days_kind_ck", sql`${table.kind} in (${sql.raw(inList(LEAVE_DAY_KINDS))})`),
    check("leave_days_origin_ck", sql`${table.origin} in (${sql.raw(inList(LEAVE_ORIGINS))})`),
    check("leave_days_pending_ck", sql`${table.pending} in (${sql.raw(inList(PENDING_STATES))})`),
    // One unit for everything: a day off is half a day or a whole one, ROL included (N0).
    check("leave_days_fraction_value_ck", sql`${table.fraction} in (0.5, 1.0)`),
    check("leave_days_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
    check(
      "leave_days_trek_kind_ck",
      sql`${table.trekKind} is null or ${table.trekKind} in (${sql.raw(inList(TREK_KINDS))})`,
    ),
    // Nobody asks Trek to delete a day Trek never had: a pending deletion needs a row Trek either
    // gave us or has already been told about (plan F7 §3.2).
    check(
      "leave_days_pending_delete_ck",
      sql`${table.pending} <> 'delete' or ${table.origin} = 'trek' or ${table.syncedAt} is not null`,
    ),
  ],
);
