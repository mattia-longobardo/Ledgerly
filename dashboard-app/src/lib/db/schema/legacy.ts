import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });
const smallMoney = (name: string) => numeric(name, { precision: 7, scale: 2 });
const tz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const funds = pgTable("funds", {
  id: smallint("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
});

export const fundSettings = pgTable(
  "fund_settings",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    fundId: smallint("fund_id")
      .notNull()
      .references(() => funds.id),
    effectiveFrom: date("effective_from").notNull(),
    initialCapital: money("initial_capital").notNull().default("0"),
    depositMode: text("deposit_mode").notNull(),
    fixedMonthlyAmount: money("fixed_monthly_amount"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("fund_settings_mode_ck", sql`${t.depositMode} IN ('fixed','payroll')`),
    check(
      "fund_settings_fixed_amount_ck",
      sql`${t.depositMode} <> 'fixed' OR ${t.fixedMonthlyAmount} IS NOT NULL`,
    ),
    uniqueIndex("fund_settings_fund_effective_uq").on(t.fundId, t.effectiveFrom),
  ],
);

export const payslips = pgTable(
  "payslips",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    month: date("month").notNull(),
    isThirteenth: boolean("is_thirteenth").notNull().default(false),
    paperlessDocId: integer("paperless_doc_id").notNull(),
    status: text("status").notNull().default("discovered"),
    rawExtraction: jsonb("raw_extraction"),
    corrections: jsonb("corrections"),
    gross: money("gross"),
    net: money("net"),
    taxes: money("taxes"),
    fundContribEmployee: money("fund_contrib_employee"),
    fundContribEmployer: money("fund_contrib_employer"),
    ferieBalance: smallMoney("ferie_balance"),
    ferieUnit: text("ferie_unit"),
    rolBalance: smallMoney("rol_balance"),
    rolUnit: text("rol_unit"),
    ferieTaken: smallMoney("ferie_taken"),
    rolTaken: smallMoney("rol_taken"),
    supersededBy: bigint("superseded_by", { mode: "number" }).references(
      (): AnyPgColumn => payslips.id,
    ),
    verifiedAt: tz("verified_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "payslips_status_ck",
      sql`${t.status} IN ('discovered','parsed','verified','rejected','superseded')`,
    ),
    check("payslips_ferie_unit_ck", sql`${t.ferieUnit} IN ('days','hours')`),
    check("payslips_rol_unit_ck", sql`${t.rolUnit} IN ('days','hours')`),
    uniqueIndex("payslips_month_thirteenth_uq").on(t.month, t.isThirteenth),
    uniqueIndex("payslips_doc_thirteenth_uq").on(t.paperlessDocId, t.isThirteenth),
    index("payslips_status_idx").on(t.status),
  ],
);

export const fundDeposits = pgTable(
  "fund_deposits",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    fundId: smallint("fund_id")
      .notNull()
      .references(() => funds.id),
    month: date("month").notNull(),
    amount: money("amount").notNull(),
    employeePart: money("employee_part"),
    employerPart: money("employer_part"),
    source: text("source").notNull(),
    payslipId: bigint("payslip_id", { mode: "number" }).references(() => payslips.id),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("fund_deposits_source_ck", sql`${t.source} IN ('fixed','payroll','manual')`),
    uniqueIndex("fund_deposits_fund_month_uq").on(t.fundId, t.month),
  ],
);

export const vacationLedger = pgTable(
  "vacation_ledger",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    entryType: text("entry_type").notNull(),
    month: date("month"),
    amount: money("amount").notNull(),
    note: text("note"),
    occurredAt: tz("occurred_at").notNull().defaultNow(),
    createdAt: tz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "vacation_ledger_type_ck",
      sql`${t.entryType} IN ('initial','accrual','withdrawal','adjustment')`,
    ),
    uniqueIndex("vacation_ledger_month_uq")
      .on(t.month)
      .where(sql`entry_type IN ('initial','accrual')`),
  ],
);

export const vacationAccrualRate = pgTable("vacation_accrual_rate", {
  effectiveFrom: date("effective_from").primaryKey(),
  monthlyAmount: money("monthly_amount").notNull(),
  createdAt: tz("created_at").notNull().defaultNow(),
});

export const balanceSnapshots = pgTable(
  "balance_snapshots",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    /**
     * No CHECK on this column any more: it used to be constrained to
     * `('wallet','teable')`, but the retirement migration (0007) dropped
     * that constraint along with the rest of the Teable integration — the
     * table is a read-only archive now (until Phase 9), and 'wallet' is the
     * only value anything still writes.
     */
    source: text("source").notNull(),
    accountKey: text("account_key").notNull(),
    balance: money("balance").notNull(),
    capturedAt: tz("captured_at").notNull().defaultNow(),
    raw: jsonb("raw"),
  },
  (t) => [index("balance_snapshots_account_captured_idx").on(t.accountKey, t.capturedAt.desc())],
);

export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigint("id", { mode: "number" }).generatedAlwaysAsIdentity().primaryKey(),
    jobName: text("job_name").notNull(),
    dedupeKey: text("dedupe_key"),
    trigger: text("trigger").notNull(),
    status: text("status").notNull().default("running"),
    attempt: integer("attempt").notNull().default(1),
    startedAt: tz("started_at").notNull().defaultNow(),
    finishedAt: tz("finished_at"),
    error: text("error"),
    detail: jsonb("detail"),
  },
  (t) => [
    check("job_runs_trigger_ck", sql`${t.trigger} IN ('cron','sweep','manual','webhook')`),
    check(
      "job_runs_status_ck",
      sql`${t.status} IN ('running','success','success_after_retry','already_done','failed','poisoned','missed')`,
    ),
    index("job_runs_name_started_idx").on(t.jobName, t.startedAt.desc()),
  ],
);

/**
 * Leave, one row per calendar day — the dashboard's mirror of Trek's
 * `vacay_entries`.
 *
 * This is the first per-date table in the schema: every other `date` column
 * here is a month anchor (`YYYY-MM-01`). It has to be per-date because the
 * payslip only ever states a monthly total in hours, while Trek states which
 * days — and the whole point of the sync is to hold both.
 *
 * `date` is the primary key rather than a surrogate id, mirroring Trek's own
 * `UNIQUE(user_id, plan_id, date)`: at most one leave row per day, enforced by
 * the same constraint on both sides, so the two can never disagree about how
 * many entries a day has.
 */
export const leaveDays = pgTable(
  "leave_days",
  {
    date: date("date").primaryKey(),
    /** 1 or 0.5 — Trek's entire domain. numeric(2,1) cannot even hold 0.25. */
    fraction: numeric("fraction", { precision: 2, scale: 1 }).notNull(),
    kind: text("kind").notNull(),
    /** Trek's `vacay_entries.id`; null until a day has been seen upstream. */
    trekEntryId: integer("trek_entry_id"),
    /** Where the day came from, for the "who wrote this" question in the UI. */
    origin: text("origin").notNull().default("trek"),
    note: text("note"),
    /**
     * A local edit waiting to reach Trek. `delete` keeps the row alive on
     * purpose: with the row gone there would be nothing left to tell the push
     * which day to remove upstream, and Trek exposes no DELETE verb — removing
     * a day needs its current fraction and kind, which only this row remembers.
     */
    pendingOp: text("pending_op").notNull().default("none"),
    /** Last time this row was confirmed against Trek. */
    syncedAt: tz("synced_at"),
    createdAt: tz("created_at").notNull().defaultNow(),
    updatedAt: tz("updated_at").notNull().defaultNow(),
  },
  (t) => [
    check("leave_days_fraction_ck", sql`${t.fraction} IN (0.5, 1)`),
    check("leave_days_kind_ck", sql`${t.kind} IN ('vacation','comp')`),
    check("leave_days_origin_ck", sql`${t.origin} IN ('trek','dashboard')`),
    check("leave_days_pending_op_ck", sql`${t.pendingOp} IN ('none','upsert','delete')`),
    // Partial: the push only ever asks for the handful of rows that are dirty.
    index("leave_days_pending_idx").on(t.pendingOp).where(sql`pending_op <> 'none'`),
  ],
);

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: tz("updated_at").notNull().defaultNow(),
});

export type Fund = typeof funds.$inferSelect;
export type FundSetting = typeof fundSettings.$inferSelect;
export type FundDeposit = typeof fundDeposits.$inferSelect;
export type VacationEntry = typeof vacationLedger.$inferSelect;
export type Payslip = typeof payslips.$inferSelect;
export type BalanceSnapshot = typeof balanceSnapshots.$inferSelect;
export type JobRun = typeof jobRuns.$inferSelect;
export type LeaveDay = typeof leaveDays.$inferSelect;
