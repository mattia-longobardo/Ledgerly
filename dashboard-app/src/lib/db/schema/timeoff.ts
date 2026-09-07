import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { payrollRecords } from "./payroll";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const qty = (n: string) => numeric(n, { precision: 8, scale: 2 });

export const timeoffTypes = pgTable("timeoff_types", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  code: text("code").notNull(),
  label: text("label").notNull(),
  unit: text("unit").notNull().default("hours"),
  hoursPerDay: numeric("hours_per_day", { precision: 4, scale: 2 }).notNull().default("8.00"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_types_code_ck", sql`${t.code} IN ('vacation','comp','permits','sick','other')`),
  check("timeoff_types_unit_ck", sql`${t.unit} IN ('hours','days')`),
  uniqueIndex("timeoff_types_user_code_uq").on(t.userId, t.code),
]);

/** One row per (type, payroll record) — spec §5.8 "one per payroll period". R7-4. */
export const timeoffBalances = pgTable("timeoff_balances", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  typeId: uuid("type_id").notNull().references(() => timeoffTypes.id, { onDelete: "cascade" }),
  asOf: date("as_of").notNull(),
  accrued: qty("accrued"),
  used: qty("used"),
  remaining: qty("remaining"),
  pending: qty("pending"),
  unit: text("unit").notNull().default("hours"),
  source: text("source").notNull().default("payroll"),
  payrollRecordId: uuid("payroll_record_id").references(() => payrollRecords.id, { onDelete: "cascade" }),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_balances_source_ck", sql`${t.source} IN ('payroll','manual')`),
  check("timeoff_balances_unit_ck", sql`${t.unit} IN ('hours','days')`),
  uniqueIndex("timeoff_balances_type_record_uq").on(t.typeId, t.payrollRecordId).where(sql`payroll_record_id IS NOT NULL`),
  index("timeoff_balances_user_asof_idx").on(t.userId, t.asOf.desc()),
]);

/** Generalises `leave_days` (spec §5.8). Trek's entry id is in provider_links (R7-3). */
export const timeoffEvents = pgTable("timeoff_events", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  typeId: uuid("type_id").notNull().references(() => timeoffTypes.id),
  date: date("date").notNull(),
  fraction: numeric("fraction", { precision: 3, scale: 2 }).notNull().default("1.00"),
  status: text("status").notNull().default("planned"),
  origin: text("origin").notNull().default("manual"),
  note: text("note"),
  pendingOp: text("pending_op").notNull().default("none"),
  syncedAt: tz("synced_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("timeoff_events_fraction_ck", sql`${t.fraction} IN (0.5, 1)`),
  check("timeoff_events_status_ck", sql`${t.status} IN ('planned','approved','taken','cancelled')`),
  check("timeoff_events_origin_ck", sql`${t.origin} IN ('manual','trek','payroll')`),
  check("timeoff_events_pending_ck", sql`${t.pendingOp} IN ('none','upsert','delete')`),
  uniqueIndex("timeoff_events_user_date_uq").on(t.userId, t.date),
  index("timeoff_events_pending_idx").on(t.userId, t.pendingOp).where(sql`pending_op <> 'none'`),
]);

export type TimeoffTypeRow = typeof timeoffTypes.$inferSelect;
export type TimeoffBalanceRow = typeof timeoffBalances.$inferSelect;
export type TimeoffEventRow = typeof timeoffEvents.$inferSelect;
