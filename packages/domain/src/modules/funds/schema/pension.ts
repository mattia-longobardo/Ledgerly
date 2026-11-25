// Funds · the tables of the payslip side: the pension rules and the competences.
import { sql } from "drizzle-orm";
import { bigint, check, date, index, pgTable, smallint, text, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { createdAtColumn, idColumn, updatedAtColumn } from "../../../platform/db/columns";
import { funds } from "./funds";

export const money = (name: string) => bigint(name, { mode: "bigint" });
export const timestamps = {
  createdAt: createdAtColumn(),
  updatedAt: updatedAtColumn(),
};

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
    /** Payroll's kind of the payslip, as its event names it. */
    kind: text("kind").notNull(),
    extraNumber: smallint("extra_number"),
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
