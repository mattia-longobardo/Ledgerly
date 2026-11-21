// Funds · the tables of the payslip side: the pension rules and the competences.
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";
import { createdAtColumn, idColumn, updatedAtColumn } from "../../../platform/db/columns";
import { LEGACY_RULE_KINDS, funds } from "./funds";

export const money = (name: string) => bigint(name, { mode: "bigint" });
export const timestamps = {
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
};

/**
 * Before N6: the contribution percentages of a contract and the schedule of the transfers with its
 * fees. Now the note, the due dates and the tolerance of a `payroll` source, and rows of `fund_fees`.
 * Not read; removed in R5f.
 */
export const pensionRules = pgTable(
  "pension_rules",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LEGACY_RULE_KINDS }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ccnl: text("ccnl"),
    base: text("base"),
    workerPct: numeric("worker_pct", { precision: 7, scale: 4 }),
    employerPct: numeric("employer_pct", { precision: 7, scale: 4 }),
    tfrPct: numeric("tfr_pct", { precision: 7, scale: 4 }),
    schedule: jsonb("schedule").$type<unknown[]>(),
    toleranceDays: smallint("tolerance_days").notNull().default(15),
    /** The fees Settings records beside the schedule (GC §6.1), for a fund with no export. */
    enrollmentFeeCents: money("enrollment_fee_cents")
      .notNull()
      .default(sql`0`),
    quarterFeeCents: money("quarter_fee_cents")
      .notNull()
      .default(sql`0`),
    source: text("source"),
    verifiedOn: date("verified_on"),
    ...timestamps,
  },
  (table) => [
    index("pension_rules_fund_idx").on(table.fundId, table.kind, table.validFrom),
    check("pension_rules_kind_ck", sql`${table.kind} in (${sql.raw(inList(LEGACY_RULE_KINDS))})`),
    check(
      "pension_rules_validity_ck",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check("pension_rules_tolerance_ck", sql`${table.toleranceDays} between 0 and 120`),
    check(
      "pension_rules_fees_ck",
      sql`${table.enrollmentFeeCents} between 0 and 100000 and ${table.quarterFeeCents} between 0 and 100000`,
    ),
    check(
      "pension_rules_pct_ck",
      sql`coalesce(${table.workerPct}, 0) between 0 and 100 and coalesce(${table.employerPct}, 0) between 0 and 100 and coalesce(${table.tfrPct}, 0) between 0 and 100`,
    ),
    check(
      "pension_rules_schedule_ck",
      sql`(${table.kind} = 'payment_schedule') = (${table.schedule} is not null)`,
    ),
    check(
      "pension_rules_text_ck",
      sql`coalesce(length(${table.ccnl}), 0) <= 120 and coalesce(length(${table.base}), 0) <= 200 and coalesce(length(${table.source}), 0) <= 300`,
    ),
  ],
);

/**
 * What one applied payslip accrued for the pension fund (spec §6, §7.7; GC §8.2–8.3): worker,
 * employer, TFR, enrolment and adjustments apart, signs kept, `null` where the payslip has no such
 * line. Written by the payroll sink when a payslip is applied, removed when it is superseded; no
 * foreign key to `payslips` (another module), the sink keeps them in step.
 */
export const pensionCompetences = pgTable(
  "pension_competences",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id").notNull(),
    payrollPeriod: date("payroll_period"),
    payslipType: text("payslip_type").notNull(),
    year: smallint("year").notNull(),
    quarter: smallint("quarter").notNull(),
    workerCents: money("worker_cents"),
    employerCents: money("employer_cents"),
    tfrCents: money("tfr_cents"),
    workerEnrollmentCents: money("worker_enrollment_cents"),
    employerEnrollmentCents: money("employer_enrollment_cents"),
    workerAdjustmentCents: money("worker_adjustment_cents"),
    employerAdjustmentCents: money("employer_adjustment_cents"),
    sourceLineIds: uuid("source_line_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    ...timestamps,
  },
  (table) => [
    unique("pension_competences_payslip_uq").on(table.payslipId),
    index("pension_competences_fund_idx").on(table.fundId, table.year, table.quarter),
    check("pension_competences_quarter_ck", sql`${table.quarter} between 1 and 4`),
    check("pension_competences_year_ck", sql`${table.year} between 1990 and 2200`),
    check(
      "pension_competences_period_ck",
      sql`${table.payrollPeriod} is null or extract(day from ${table.payrollPeriod}) = 1`,
    ),
  ],
);

/**
 * Where a fund's money comes from (extension point E2): the payslip, a recurring debit on an
 * account, or payments entered by hand. A source describes the plan; the paid-in amount always
 * comes from the operations. The columns a kind does not use stay `null`.
 */
