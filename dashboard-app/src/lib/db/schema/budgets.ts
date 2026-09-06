import { check, date, index, integer, jsonb, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { transactions } from "./transactions";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const budgets = pgTable("budgets", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  description: text("description"),
  currency: text("currency").notNull().default("EUR"),
  status: text("status").notNull().default("active"),
  periodKind: text("period_kind").notNull().default("none"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  goalAmount: money("goal_amount"),
  labels: jsonb("labels").$type<string[]>().notNull().default([]),
  archivedAt: tz("archived_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("budgets_status_ck", sql`${t.status} IN ('active','archived')`),
  check("budgets_period_ck", sql`${t.periodKind} IN ('none','monthly','quarterly','annual','custom')`),
  check("budgets_dates_ck", sql`${t.endDate} IS NULL OR ${t.startDate} <= ${t.endDate}`),
  index("budgets_user_status_idx").on(t.userId, t.status),
]);

/** Full history of the initial amount (spec §5.6). The row effective at a date is the latest effective_from <= date. */
export const budgetAmountVersions = pgTable("budget_amount_versions", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  initialAmount: money("initial_amount").notNull(),
  effectiveFrom: date("effective_from").notNull(),
  reason: text("reason"),
  actorUserId: uuid("actor_user_id"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("budget_amount_versions_uq").on(t.budgetId, t.effectiveFrom)]);

/** Virtual. Never moves money (spec §5.6). R6-1: source_kind 'none' allowed; R6-2: recurrence. */
export const budgetAllocations = pgTable("budget_allocations", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull().default("none"),
  sourceId: uuid("source_id"),
  amount: money("amount").notNull(),
  recurrence: text("recurrence").notNull().default("once"),
  effectiveFrom: date("effective_from").notNull(),
  effectiveTo: date("effective_to"),
  note: text("note"),
  actorUserId: uuid("actor_user_id"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("budget_allocations_source_ck", sql`${t.sourceKind} IN ('fund','account','none')`),
  check("budget_allocations_source_id_ck", sql`(${t.sourceKind} = 'none') = (${t.sourceId} IS NULL)`),
  check("budget_allocations_recurrence_ck", sql`${t.recurrence} IN ('once','monthly')`),
  check("budget_allocations_dates_ck", sql`${t.effectiveTo} IS NULL OR ${t.effectiveFrom} <= ${t.effectiveTo}`),
  index("budget_allocations_source_idx").on(t.sourceKind, t.sourceId),
]);

export const budgetScopes = pgTable("budget_scopes", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  refId: uuid("ref_id").notNull(),
}, (t) => [
  check("budget_scopes_kind_ck", sql`${t.kind} IN ('account','category','label','fund')`),
  uniqueIndex("budget_scopes_uq").on(t.budgetId, t.kind, t.refId),
]);

/** Materialised usage link (spec §5.6). R6-3: scope rows are re-derived; manual rows are user-owned. */
export const budgetUsages = pgTable("budget_usages", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "cascade" }),
  amount: money("amount").notNull(),
  occurredAt: date("occurred_at").notNull(),
  matchedBy: text("matched_by").notNull(),
  note: text("note"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("budget_usages_matched_ck", sql`${t.matchedBy} IN ('scope','manual')`),
  check("budget_usages_tx_ck", sql`(${t.matchedBy} = 'scope') = (${t.transactionId} IS NOT NULL)`),
  uniqueIndex("budget_usages_tx_uq").on(t.budgetId, t.transactionId).where(sql`transaction_id IS NOT NULL`),
  index("budget_usages_budget_occurred_idx").on(t.budgetId, t.occurredAt),
]);

export const budgetEvents = pgTable("budget_events", {
  id: id(),
  budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  detail: jsonb("detail").notNull().default({}),
  actorUserId: uuid("actor_user_id"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [index("budget_events_budget_created_idx").on(t.budgetId, t.createdAt.desc())]);

export type BudgetRow = typeof budgets.$inferSelect;
export type BudgetAmountVersionRow = typeof budgetAmountVersions.$inferSelect;
export type BudgetAllocationRow = typeof budgetAllocations.$inferSelect;
export type BudgetScopeRow = typeof budgetScopes.$inferSelect;
export type BudgetUsageRow = typeof budgetUsages.$inferSelect;
export type BudgetEventRow = typeof budgetEvents.$inferSelect;
