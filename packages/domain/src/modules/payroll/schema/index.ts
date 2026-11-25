import { sql } from "drizzle-orm";
import { type AnyPgColumn, bigint, boolean, check, date, doublePrecision, index, jsonb, numeric, pgTable, smallint, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../../platform/db/columns";
import { users } from "../../../platform/auth/schema";
import { documents } from "../../imports/schema";
import { LEAVE_KINDS } from "../fields";
import type { CheckResult, Warning } from "../parse/checks";
import { CODE_ROLES, LINE_UNITS, MAX_EXTRA_PAYMENTS, PAY_FREQUENCIES, PAYSLIP_KINDS, PAYSLIP_SOURCES } from "../rules";
import { inList } from "../../../platform/db/checks";
import { legacyFieldColumns, legacyPayslipChecks, legacyTypeColumn } from "./legacy";

const money = (name: string) => bigint(name, { mode: "bigint" });
const hours = (name: string) => numeric(name, { precision: 8, scale: 2 });

/**
 * One line of a payslip's body as printed (spec §6; owner's spec L51–54): the raw layer, before any
 * meaning is given to it. Amounts keep their sign and their column.
 */
export const payrollRawLines = pgTable(
  "payroll_raw_lines",
  {
    id: idColumn(),
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
    createdAt: createdAtColumn(),
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
 * shares (employer + employee + year/period + type), its kind and the base amounts of the core,
 * `null` when the document does not show them; the country's fields are pairs of `payslip_fields`
 * (R5g, E4). A read payslip's values are the evidence's, corrections applied, rewritten whenever the
 * evidence changes; a manual one (`source` `manual`, ST-21) has the person's and an optional
 * document. `active` marks the one applied, not superseded, payslip of a logical key — the database
 * allows one.
 */
export const payslips = pgTable(
  "payslips",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for a payslip typed by hand without its PDF (R5g). */
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    employerKey: text("employer_key").notNull(),
    employeeKey: text("employee_key").notNull(),
    year: smallint("year").notNull(),
    period: date("period"),
    ...legacyTypeColumn(),
    /** Null only on a row the image before R5g wrote: its old `type` says it. */
    kind: text("kind", { enum: PAYSLIP_KINDS }),
    /** The employer's extra payment it is: 1 for the first (a 13th), 2 for the second… */
    extraNumber: smallint("extra_number"),
    source: text("source", { enum: PAYSLIP_SOURCES }).notNull().default("read"),
    printedOn: date("printed_on"),
    paidOn: date("paid_on"),
    active: boolean("active").notNull().default(false),
    appliedAt: moment("applied_at"),
    supersededBy: uuid("superseded_by").references((): AnyPgColumn => payslips.id, {
      onDelete: "set null",
    }),
    checks: jsonb("checks").$type<CheckResult[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<Warning[]>().notNull().default([]),

    gross: money("gross"),
    taxesTotal: money("taxes_total"),
    employeeSocial: money("employee_social"),
    netPay: money("net_pay"),
    ...legacyFieldColumns(),

    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
    // The key the code checks since R5f.1: kind and extra payment, not the old type.
    uniqueIndex("payslips_active_kind_uq")
      .on(
        table.userId,
        table.employerKey,
        table.employeeKey,
        table.year,
        table.kind,
        sql`coalesce(${table.extraNumber}, 0)`,
        sql`coalesce(${table.period}, '0001-01-01'::date)`,
      )
      .where(sql`${table.active}`),
    index("payslips_user_year_idx").on(table.userId, table.year),
    ...legacyPayslipChecks(table),
    check("payslips_kind_ck", sql`${table.kind} is null or ${table.kind} in (${sql.raw(inList(PAYSLIP_KINDS))})`),
    check("payslips_source_ck", sql`${table.source} in (${sql.raw(inList(PAYSLIP_SOURCES))})`),
    check("payslips_document_ck", sql`${table.source} = 'manual' or ${table.documentId} is not null`),
    // An extra payment has its number and no month; an ordinary payslip has its month.
    check(
      "payslips_extra_number_ck",
      sql`(${table.kind} = 'extra') = (${table.extraNumber} is not null) or ${table.kind} is null`,
    ),
    check("payslips_extra_number_range_ck", sql`${table.extraNumber} is null or ${table.extraNumber} >= 1`),
    check(
      "payslips_period_kind_ck",
      sql`(${table.kind} is distinct from 'ordinary' or ${table.period} is not null) and (${table.kind} is distinct from 'extra' or ${table.period} is null)`,
    ),
    check("payslips_year_ck", sql`${table.year} between 1990 and 2200`),
    check(
      "payslips_period_ck",
      sql`${table.period} is null or (extract(day from ${table.period}) = 1 and extract(year from ${table.period}) = ${table.year})`,
    ),
    check("payslips_active_ck", sql`not ${table.active} or ${table.appliedAt} is not null`),
  ],
);

/**
 * The payroll code map (spec §6, §7.8): which field or family each body code of a layout profile
 * feeds. Seeded from the codes of the reading profile on a person's first import, editable in
 * Settings › Data.
 */
export const payrollCodeMap = pgTable(
  "payroll_code_map",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    profile: text("profile").notNull(),
    code: text("code").notNull(),
    role: text("role", { enum: CODE_ROLES }).notNull(),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
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

/**
 * A field of a payslip beyond the base ones (R5g, E4): a key of the catalogue of the country's pack
 * and its amount in cents — every field a pack has is an amount. A read payslip writes one for every field
 * of the catalogue it shows; the fixed columns of `payslips` stay written beside them until R5f.
 * The key is an open vocabulary (M13): the pack checks it, the database its form.
 */
export const payslipFields = pgTable(
  "payslip_fields",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payslipId: uuid("payslip_id")
      .notNull()
      .references(() => payslips.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueCents: money("value_cents").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("payslip_fields_key_uq").on(table.payslipId, table.key),
    index("payslip_fields_user_idx").on(table.userId),
    check("payslip_fields_key_ck", sql`${table.key} ~ '^[a-z][A-Za-z0-9_]{0,63}$'`),
  ],
);

/**
 * How a person's employer pays (R5g, E6): the frequency and the month of each extra payment, in
 * order (the 1st, a 13th; the 2nd, a 14th…). One per person; none is the default of the rules.
 */
export const payrollEmployers = pgTable(
  "payroll_employers",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    payFrequency: text("pay_frequency", { enum: PAY_FREQUENCIES }).notNull().default("monthly"),
    extraMonths: smallint("extra_months").array().notNull().default(sql`'{}'::smallint[]`),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("payroll_employers_user_uq").on(table.userId),
    check("payroll_employers_frequency_ck", sql`${table.payFrequency} in (${sql.raw(inList(PAY_FREQUENCIES))})`),
    check(
      "payroll_employers_extra_months_ck",
      sql`cardinality(${table.extraMonths}) <= ${sql.raw(String(MAX_EXTRA_PAYMENTS))} and ${table.extraMonths} <@ '{1,2,3,4,5,6,7,8,9,10,11,12}'::smallint[]`,
    ),
  ],
);
