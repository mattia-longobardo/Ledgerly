import { check, date, index, integer, jsonb, numeric, pgTable, smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./identity";
import { accounts } from "./accounts";
import { payrollRecords } from "./payroll";

const tz = (n: string) => timestamp(n, { withTimezone: true, mode: "date" });
const id = () => uuid("id").primaryKey().default(sql`uuidv7()`);
const money = (n: string) => numeric(n, { precision: 16, scale: 2 });

export const funds = pgTable("funds", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  kind: text("kind").notNull(),
  currency: text("currency").notNull().default("EUR"),
  /** The account whose `account_balances` are this fund's value (spec §5.5). Null = unvalued. */
  accountId: uuid("account_id").references(() => accounts.id),
  status: text("status").notNull().default("active"),
  archivedAt: tz("archived_at"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("funds_kind_ck", sql`${t.kind} IN ('pension','investment','savings','other')`),
  check("funds_status_ck", sql`${t.status} IN ('active','archived')`),
  uniqueIndex("funds_user_slug_uq").on(t.userId, t.slug),
]);

/** Static catalogue (spec §5.5). Seeded by the migration; no RLS; in STATIC_TABLES. */
export const fundContributionTypes = pgTable("fund_contribution_types", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  /** +1 for inflows, -1 for fees and reversals, 0 for adjustments (either sign). */
  sign: smallint("sign").notNull(),
});

export const fundContributionSchedules = pgTable("fund_contribution_schedules", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  frequency: text("frequency").notNull(),
  periodAnchorMonth: smallint("period_anchor_month").notNull().default(1),
  postingLagMonths: smallint("posting_lag_months").notNull().default(1),
  feePerPosting: money("fee_per_posting").notNull().default("0.00"),
  effectiveFrom: date("effective_from").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [
  check("fund_schedules_frequency_ck", sql`${t.frequency} IN ('monthly','quarterly','annual')`),
  check("fund_schedules_anchor_ck", sql`${t.periodAnchorMonth} BETWEEN 1 AND 12`),
  check("fund_schedules_lag_ck", sql`${t.postingLagMonths} BETWEEN 0 AND 12`),
  uniqueIndex("fund_schedules_fund_effective_uq").on(t.fundId, t.effectiveFrom),
]);

/** Replaces `fund_settings` (initial capital, fixed monthly amount). Effective-dated. */
export const fundPlans = pgTable("fund_plans", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  effectiveFrom: date("effective_from").notNull(),
  initialCapital: money("initial_capital").notNull().default("0.00"),
  fixedMonthlyAmount: money("fixed_monthly_amount"),
  note: text("note"),
  createdAt: tz("created_at").notNull().defaultNow(),
}, (t) => [uniqueIndex("fund_plans_fund_effective_uq").on(t.fundId, t.effectiveFrom)]);

export const fundContributions = pgTable("fund_contributions", {
  id: id(),
  fundId: uuid("fund_id").notNull().references(() => funds.id, { onDelete: "cascade" }),
  typeCode: text("type_code").notNull().references(() => fundContributionTypes.code),
  accrualPeriodStart: date("accrual_period_start").notNull(),
  accrualPeriodEnd: date("accrual_period_end").notNull(),
  postedMonth: date("posted_month").notNull(),
  valueDate: date("value_date"),
  amount: money("amount").notNull(),
  currency: text("currency").notNull().default("EUR"),
  source: text("source").notNull(),
  payrollRecordId: uuid("payroll_record_id").references(() => payrollRecords.id),
  note: text("note"),
  reversesId: uuid("reverses_id").references((): AnyPgColumn => fundContributions.id),
  reconciliationStatus: text("reconciliation_status").notNull().default("received"),
  version: integer("version").notNull().default(1),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("fund_contributions_source_ck", sql`${t.source} IN ('manual','payroll','system','migration')`),
  check("fund_contributions_recon_ck", sql`${t.reconciliationStatus} IN ('expected','received','matched','missing','delayed','duplicate','anomalous')`),
  check("fund_contributions_period_ck", sql`${t.accrualPeriodStart} <= ${t.accrualPeriodEnd}`),
  index("fund_contributions_fund_posted_idx").on(t.fundId, t.postedMonth),
  uniqueIndex("fund_contributions_payroll_uq").on(t.fundId, t.typeCode, t.payrollRecordId).where(sql`payroll_record_id IS NOT NULL`),
  uniqueIndex("fund_contributions_system_fee_uq").on(t.fundId, t.postedMonth).where(sql`type_code = 'fee' AND source = 'system'`),
]);

export const reconciliationIssues = pgTable("reconciliation_issues", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  domain: text("domain").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  kind: text("kind").notNull(),
  severity: text("severity").notNull().default("warning"),
  detail: jsonb("detail").notNull().default({}),
  status: text("status").notNull().default("open"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: tz("resolved_at"),
  createdAt: tz("created_at").notNull().defaultNow(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
}, (t) => [
  check("reconciliation_issues_severity_ck", sql`${t.severity} IN ('info','warning','error')`),
  check("reconciliation_issues_status_ck", sql`${t.status} IN ('open','acknowledged','resolved')`),
  uniqueIndex("reconciliation_issues_live_uq").on(t.userId, t.domain, t.entityType, t.entityId, t.kind).where(sql`status <> 'resolved'`),
  index("reconciliation_issues_user_status_idx").on(t.userId, t.status),
]);

export type FundRow = typeof funds.$inferSelect;
export type FundScheduleRow = typeof fundContributionSchedules.$inferSelect;
export type FundPlanRow = typeof fundPlans.$inferSelect;
export type FundContributionRow = typeof fundContributions.$inferSelect;
export type ReconciliationIssueRow = typeof reconciliationIssues.$inferSelect;
