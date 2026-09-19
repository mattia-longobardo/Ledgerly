import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  doublePrecision,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import { documents } from "../imports/schema";
import { LEAVE_KINDS } from "./fields";
import type { CheckResult, Warning } from "./parse/checks";
import { CODE_ROLES, LINE_UNITS, PAYSLIP_TYPES, TFR_SOURCES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const money = (name: string) => bigint(name, { mode: "bigint" });
const hours = (name: string) => numeric(name, { precision: 8, scale: 2 });

/**
 * One line of a payslip's body as printed (spec §6; owner's spec L51–54): the raw layer, before any
 * meaning is given to it. Amounts keep their sign and their column.
 */
export const payrollRawLines = pgTable(
  "payroll_raw_lines",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 5 }),
    quantityUnit: text("quantity_unit", { enum: LINE_UNITS }),
    rate: numeric("rate", { precision: 14, scale: 5 }),
    earningsCents: money("earnings_cents"),
    deductionsCents: money("deductions_cents"),
    statisticalCents: money("statistical_cents"),
    page: smallint("page").notNull(),
    bbox: doublePrecision("bbox").array().notNull(),
    rawText: text("raw_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("payroll_raw_lines_position_uq").on(table.documentId, table.position),
    check(
      "payroll_raw_lines_unit_ck",
      sql`${table.quantityUnit} is null or ${table.quantityUnit} in (${sql.raw(inList(LINE_UNITS))})`,
    ),
    check("payroll_raw_lines_bbox_ck", sql`cardinality(${table.bbox}) = 4`),
  ],
);

/**
 * A payslip (spec §6, §7.8; owner's spec L42–87): its identity, the logical key a rectification
 * shares (employer + employee + year/period + type), and every amount the fields catalogue lists,
 * `null` when the document does not show it. The values are the evidence's, corrections applied;
 * they are rewritten whenever the evidence changes. `active` marks the one applied, not superseded,
 * payslip of a logical key — the database allows one.
 */
export const payslips = pgTable(
  "payslips",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    employerKey: text("employer_key").notNull(),
    employeeKey: text("employee_key").notNull(),
    year: smallint("year").notNull(),
    period: date("period"),
    type: text("type", { enum: PAYSLIP_TYPES }).notNull(),
    printedOn: date("printed_on"),
    paidOn: date("paid_on"),
    active: boolean("active").notNull().default(false),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => payslips.id, {
      onDelete: "set null",
    }),
    checks: jsonb("checks").$type<CheckResult[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<Warning[]>().notNull().default([]),

    contractualGross: money("contractual_gross"),
    ordinaryEarnings: money("ordinary_earnings"),
    totalGrossPrinted: money("total_gross_printed"),
    welfareCash: money("welfare_cash"),
    welfareInKind: money("welfare_in_kind"),
    gross: money("gross"),

    irpefTaxable: money("irpef_taxable"),
    irpefGross: money("irpef_gross"),
    taxDeductions: money("tax_deductions"),
    irpefWithheld: money("irpef_withheld"),
    yearEndAdjustment: money("year_end_adjustment"),
    regionalInstallment: money("regional_installment"),
    municipalWithheld: money("municipal_withheld"),
    substituteTax: money("substitute_tax"),
    refund730: money("refund_730"),
    compensatedCredit: money("compensated_credit"),
    taxesTotal: money("taxes_total"),
    taxesNetOfRefunds: money("taxes_net_of_refunds"),

    employeeSocial: money("employee_social"),
    employeeFundRegular: money("employee_fund_regular"),
    employeeFundAdjustments: money("employee_fund_adjustments"),
    employeeFundEnrollment: money("employee_fund_enrollment"),
    employeeFundEffective: money("employee_fund_effective"),
    employerFundPrinted: money("employer_fund_printed"),
    employerFundAdjustments: money("employer_fund_adjustments"),
    employerFundEnrollment: money("employer_fund_enrollment"),
    employerFundEffective: money("employer_fund_effective"),
    employerSocialTotal: money("employer_social_total"),

    tfrMonthField: money("tfr_month_field"),
    tfrContributionLine: money("tfr_contribution_line"),
    tfrSelected: money("tfr_selected"),
    tfrSource: text("tfr_source", { enum: TFR_SOURCES }),

    bodyEarnings: money("body_earnings"),
    bodyDeductions: money("body_deductions"),
    bodyDeductionsPrinted: money("body_deductions_printed"),
    totalDeductionsPrinted: money("total_deductions_printed"),
    roundingPrevious: money("rounding_previous"),
    roundingCurrent: money("rounding_current"),
    netPay: money("net_pay"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("payslips_document_uq").on(table.documentId),
    uniqueIndex("payslips_active_key_uq")
      .on(
        table.userId,
        table.employerKey,
        table.employeeKey,
        table.year,
        table.type,
        sql`coalesce(${table.period}, '0001-01-01'::date)`,
      )
      .where(sql`${table.active}`),
    index("payslips_user_year_idx").on(table.userId, table.year),
    check("payslips_type_ck", sql`${table.type} in (${sql.raw(inList(PAYSLIP_TYPES))})`),
    check(
      "payslips_tfr_source_ck",
      sql`${table.tfrSource} is null or ${table.tfrSource} in (${sql.raw(inList(TFR_SOURCES))})`,
    ),
    check("payslips_year_ck", sql`${table.year} between 1990 and 2200`),
    check(
      "payslips_period_ck",
      sql`${table.period} is null or (extract(day from ${table.period}) = 1 and extract(year from ${table.period}) = ${table.year})`,
    ),
    // An ordinary payslip has its month; a 13th or 14th has none to invent (owner's spec L37).
    check(
      "payslips_period_type_ck",
      sql`(${table.type} <> 'ordinary' or ${table.period} is not null) and (${table.type} not in ('thirteenth', 'fourteenth') or ${table.period} is null)`,
    ),
    check("payslips_active_ck", sql`not ${table.active} or ${table.appliedAt} is not null`),
  ],
);

/**
 * The payroll code map (spec §6, §7.8): which field or family each body code of a layout profile
 * feeds. Seeded from the Reply/TeamSystem profile on a person's first import, editable in
 * Settings › Data.
 */
export const payrollCodeMap = pgTable(
  "payroll_code_map",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profile: text("profile").notNull(),
    code: text("code").notNull(),
    role: text("role", { enum: CODE_ROLES }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("payroll_code_map_code_uq").on(table.userId, table.profile, table.code),
    check("payroll_code_map_role_ck", sql`${table.role} in (${sql.raw(inList(CODE_ROLES))})`),
    check("payroll_code_map_code_ck", sql`${table.code} ~ '^[0-9]{1,6}$'`),
    check("payroll_code_map_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
  ],
);

/**
 * A leave balance as an applied payslip printed it (spec §7.8; owner's spec L163–182): a snapshot,
 * never summed across months. A 13th writes none.
 */
export const leaveBalanceSnapshots = pgTable(
  "leave_balance_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LEAVE_KINDS }).notNull(),
    period: date("period").notNull(),
    previousYear: hours("previous_year"),
    accrued: hours("accrued"),
    used: hours("used"),
    remaining: hours("remaining"),
    unit: text("unit").notNull().default("hours"),
    unitEvidence: text("unit_evidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("leave_balance_snapshots_kind_uq").on(table.payslipId, table.kind),
    index("leave_balance_snapshots_user_period_idx").on(table.userId, table.period),
    check("leave_balance_snapshots_kind_ck", sql`${table.kind} in (${sql.raw(inList(LEAVE_KINDS))})`),
    check("leave_balance_snapshots_unit_ck", sql`${table.unit} = 'hours'`),
  ],
);

/**
 * Leave taken, from the body lines of an applied payslip (spec §7.8): counted once per pair of
 * lines, in the month it was used — the payslip's month minus one (owner's spec L9–20).
 */
export const payrollLeaveEvents = pgTable(
  "payroll_leave_events",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: LEAVE_KINDS }).notNull(),
    hours: hours("hours").notNull(),
    payrollPeriod: date("payroll_period").notNull(),
    usagePeriod: date("usage_period").notNull(),
    sourceLineIds: uuid("source_line_ids").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payroll_leave_events_user_usage_idx").on(table.userId, table.usagePeriod),
    index("payroll_leave_events_payslip_idx").on(table.payslipId),
    check("payroll_leave_events_kind_ck", sql`${table.kind} in (${sql.raw(inList(LEAVE_KINDS))})`),
    check("payroll_leave_events_hours_ck", sql`${table.hours} > 0`),
    check(
      "payroll_leave_events_usage_ck",
      sql`${table.usagePeriod} = (${table.payrollPeriod} - interval '1 month')::date`,
    ),
  ],
);
