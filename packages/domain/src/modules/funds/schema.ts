import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
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
import { accounts, balanceEntries } from "../accounts/schema";
import { documents } from "../imports/schema";
import { transactions } from "../transactions/schema";
import { COMPONENTS, DECISIONS, OPERATION_CLASSES, OPERATION_SOURCES } from "./pension/rules";
import { FEE_BASES, FEE_PERIODS } from "./fees";
import { FUND_STATES, VALUATION_SOURCES } from "./rules";
import {
  ACCRUAL_PERIODS,
  type DueEntry,
  INTERVAL_UNITS,
  PAYROLL_COMPONENTS,
  SOURCE_KINDS,
  SOURCE_STATES,
} from "./sources";

/**
 * What the tables of before the single fund model still check (release N6). The code reads and
 * writes none of them: they stay as they are, for the image before N6, until release R5f removes
 * them. A new fund takes the column defaults.
 */
const LEGACY_FUND_TYPES = ["pac", "pension"] as const;
const LEGACY_DEPOSIT_SOURCES = ["manual", "rule"] as const;
const LEGACY_RULE_KINDS = ["contribution", "payment_schedule"] as const;

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A pension fund: its name, who runs it, and the account that holds its value, so net worth has one
 * source. Where the money comes from is in `fund_contribution_sources`, what it costs in `fund_fees`.
 *
 * `type`, `isin`, `debit_account_id`, `debit_day`, `ter`, `monthly_cents`, `deposit_fee_cents` and
 * `receives_payroll` are of the model before N6: nothing reads or writes them, and R5f removes them.
 */
export const funds = pgTable(
  "funds",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type", { enum: LEGACY_FUND_TYPES }).notNull().default("pension"),
    provider: text("provider"),
    isin: text("isin"),
    /** The fund's or the position's identifier, as the person writes it. */
    code: text("code"),
    compartment: text("compartment"),
    valuationAccountId: uuid("valuation_account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "no action" }),
    debitAccountId: uuid("debit_account_id").references(() => accounts.id, { onDelete: "no action" }),
    debitDay: smallint("debit_day"),
    ter: numeric("ter", { precision: 10, scale: 6 }),
    startOn: date("start_on").notNull(),
    monthlyCents: bigint("monthly_cents", { mode: "bigint" }),
    depositFeeCents: bigint("deposit_fee_cents", { mode: "bigint" }),
    state: text("state", { enum: FUND_STATES }).notNull().default("active"),
    /** The pension fund the payslips' competences go to (plan F6 §3.6.2): one per person. */
    receivesPayroll: boolean("receives_payroll").notNull().default(false),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("funds_valuation_account_uq").on(table.valuationAccountId),
    unique("funds_user_name_uq").on(table.userId, table.name),
    index("funds_debit_account_idx").on(table.debitAccountId),
    check("funds_type_ck", sql`${table.type} in (${sql.raw(inList(LEGACY_FUND_TYPES))})`),
    check("funds_state_ck", sql`${table.state} in (${sql.raw(inList(FUND_STATES))})`),
    check("funds_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("funds_code_ck", sql`${table.code} is null or length(${table.code}) <= 40`),
    check("funds_isin_ck", sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`),
    check("funds_debit_day_ck", sql`${table.debitDay} is null or ${table.debitDay} between 1 and 31`),
    check("funds_ter_ck", sql`${table.ter} is null or ${table.ter} between 0 and 1`),
    check("funds_monthly_ck", sql`${table.monthlyCents} is null or ${table.monthlyCents} > 0`),
    check("funds_fee_ck", sql`${table.depositFeeCents} is null or ${table.depositFeeCents} >= 0`),
    check("funds_archived_ck", sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`),
    check("funds_receives_payroll_ck", sql`not ${table.receivesPayroll} or ${table.type} = 'pension'`),
    uniqueIndex("funds_receives_payroll_uq")
      .on(table.userId)
      .where(sql`${table.receivesPayroll}`),
  ],
);

/**
 * A valuation of a fund (spec §7.7): its value is the `manual` balance entry it wrote on the
 * valuation account — one source (plan F4 §3.6.3) — and this row keeps what a balance has no place
 * for: units and a note. Deleting that balance entry takes the valuation with it.
 */
export const fundValuations = pgTable(
  "fund_valuations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    balanceEntryId: uuid("balance_entry_id")
      .notNull()
      .references(() => balanceEntries.id, { onDelete: "cascade" }),
    units: numeric("units", { precision: 18, scale: 6 }),
    note: text("note"),
    source: text("source", { enum: VALUATION_SOURCES }).notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_valuations_entry_uq").on(table.balanceEntryId),
    index("fund_valuations_fund_idx").on(table.fundId),
    check("fund_valuations_source_ck", sql`${table.source} in (${sql.raw(inList(VALUATION_SOURCES))})`),
    check("fund_valuations_units_ck", sql`${table.units} is null or ${table.units} >= 0`),
  ],
);

/** Before N6: a deposit of a fund with a debit plan. Now a `voluntary` operation. Not read; removed in R5f. */
export const fundDeposits = pgTable(
  "fund_deposits",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    chargedCents: bigint("charged_cents", { mode: "bigint" }).notNull(),
    feeCents: bigint("fee_cents", { mode: "bigint" }),
    investedCents: bigint("invested_cents", { mode: "bigint" }).generatedAlwaysAs(
      sql`charged_cents - fee_cents`,
    ),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    source: text("source", { enum: LEGACY_DEPOSIT_SOURCES }).notNull().default("manual"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_deposits_transaction_uq").on(table.transactionId),
    index("fund_deposits_fund_on_idx").on(table.fundId, table.on),
    check("fund_deposits_source_ck", sql`${table.source} in (${sql.raw(inList(LEGACY_DEPOSIT_SOURCES))})`),
    check("fund_deposits_charged_ck", sql`${table.chargedCents} > 0`),
    check(
      "fund_deposits_fee_ck",
      sql`${table.feeCents} is null or (${table.feeCents} >= 0 and ${table.feeCents} <= ${table.chargedCents})`,
    ),
  ],
);

/** Before N6: the rule of a fund's debit. Now a `bank_debit` source. Not read; removed in R5f. */
export const fundDepositRules = pgTable(
  "fund_deposit_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    payeeMatch: text("payee_match").notNull(),
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "no action" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("fund_deposit_rules_fund_uq").on(table.fundId),
    index("fund_deposit_rules_account_idx").on(table.accountId),
    check("fund_deposit_rules_match_ck", sql`length(btrim(${table.payeeMatch})) between 1 and 80`),
  ],
);

const money = (name: string) => bigint(name, { mode: "bigint" });
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/**
 * Before N6: the contribution percentages of a contract and the schedule of the transfers with its
 * fees. Now the note, the due dates and the tolerance of a `payroll` source, and rows of `fund_fees`.
 * Not read; removed in R5f.
 */
export const pensionRules = pgTable(
  "pension_rules",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
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
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
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
export const fundContributionSources = pgTable(
  "fund_contribution_sources",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
    state: text("state", { enum: SOURCE_STATES }).notNull().default("active"),
    /** `payroll`: which parts of the payslip go to this fund. */
    components: text("components", { enum: PAYROLL_COMPONENTS }).array(),
    /** `payroll`: the span one transfer is for. */
    accrualPeriod: text("accrual_period", { enum: ACCRUAL_PERIODS }),
    employer: text("employer"),
    /** `payroll`: the transfer is due on this day, `due_offset_months` after the period's last month. */
    dueDay: smallint("due_day"),
    dueOffsetMonths: smallint("due_offset_months"),
    /** `payroll`: explicit due dates the two fields above cannot say; they win over them. */
    dueEntries: jsonb("due_entries").$type<DueEntry[]>(),
    toleranceDays: smallint("tolerance_days"),
    /** `bank_debit`: the account the debit leaves; `null` for any account. */
    accountId: uuid("account_id").references(() => accounts.id, { onDelete: "no action" }),
    payeeMatch: text("payee_match"),
    amountCents: bigint("amount_cents", { mode: "bigint" }),
    debitDay: smallint("debit_day"),
    /** `bank_debit`: every `interval_count` weeks, months or years. */
    intervalCount: smallint("interval_count"),
    intervalUnit: text("interval_unit", { enum: INTERVAL_UNITS }),
    /** The first and the last day of the plan; `null` for the fund's own start and for no end. */
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("fund_contribution_sources_fund_idx").on(table.fundId, table.kind),
    index("fund_contribution_sources_account_idx").on(table.accountId),
    uniqueIndex("fund_contribution_sources_manual_uq")
      .on(table.fundId)
      .where(sql`${table.kind} = 'manual'`),
    check("fund_contribution_sources_kind_ck", sql`${table.kind} in (${sql.raw(inList(SOURCE_KINDS))})`),
    check("fund_contribution_sources_state_ck", sql`${table.state} in (${sql.raw(inList(SOURCE_STATES))})`),
    check(
      "fund_contribution_sources_components_ck",
      sql`(${table.kind} = 'payroll') = (${table.components} is not null) and (${table.components} is null or (cardinality(${table.components}) between 1 and 3 and ${table.components} <@ array[${sql.raw(inList(PAYROLL_COMPONENTS))}]::text[]))`,
    ),
    check(
      "fund_contribution_sources_period_ck",
      sql`(${table.kind} = 'payroll') = (${table.accrualPeriod} is not null) and (${table.accrualPeriod} is null or ${table.accrualPeriod} in (${sql.raw(inList(ACCRUAL_PERIODS))}))`,
    ),
    check(
      "fund_contribution_sources_due_ck",
      sql`(${table.dueDay} is null) = (${table.dueOffsetMonths} is null) and (${table.dueDay} is null or (${table.dueDay} between 1 and 31 and ${table.dueOffsetMonths} between 0 and 3)) and (${table.toleranceDays} is null or ${table.toleranceDays} between 0 and 120)`,
    ),
    check(
      "fund_contribution_sources_interval_ck",
      sql`(${table.kind} = 'bank_debit') = (${table.intervalCount} is not null) and (${table.intervalCount} is null) = (${table.intervalUnit} is null) and (${table.intervalCount} is null or (${table.intervalCount} between 1 and 120 and ${table.intervalUnit} in (${sql.raw(inList(INTERVAL_UNITS))})))`,
    ),
    check(
      "fund_contribution_sources_debit_ck",
      sql`(${table.amountCents} is null or ${table.amountCents} > 0) and (${table.debitDay} is null or ${table.debitDay} between 1 and 31) and (${table.payeeMatch} is null or length(btrim(${table.payeeMatch})) between 1 and 80)`,
    ),
    check(
      "fund_contribution_sources_validity_ck",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check(
      "fund_contribution_sources_text_ck",
      sql`coalesce(length(${table.employer}), 0) <= 120 and coalesce(length(${table.note}), 0) <= 300`,
    ),
  ],
);

/**
 * What a fund costs, one row per fee (extension point E3): a fixed amount or a percentage, on
 * joining, on each contribution, at intervals, on the assets or on request. It explains and
 * estimates; the fee written on an operation is the one that counts.
 */
export const fundFees = pgTable(
  "fund_fees",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    basis: text("basis", { enum: FEE_BASES }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }),
    rate: numeric("rate", { precision: 8, scale: 6 }),
    period: text("period", { enum: FEE_PERIODS }),
    sourceId: uuid("source_id").references(() => fundContributionSources.id, { onDelete: "cascade" }),
    component: text("component", { enum: PAYROLL_COMPONENTS }),
    validFrom: date("valid_from"),
    validTo: date("valid_to"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("fund_fees_fund_idx").on(table.fundId),
    index("fund_fees_source_idx").on(table.sourceId),
    check("fund_fees_label_ck", sql`length(btrim(${table.label})) between 1 and 80`),
    check("fund_fees_basis_ck", sql`${table.basis} in (${sql.raw(inList(FEE_BASES))})`),
    check(
      "fund_fees_value_ck",
      sql`(${table.amountCents} is null) <> (${table.rate} is null) and (${table.amountCents} is null or ${table.amountCents} > 0) and (${table.rate} is null or (${table.rate} > 0 and ${table.rate} <= 1))`,
    ),
    check(
      "fund_fees_period_ck",
      sql`(${table.basis} in ('periodic', 'on_assets')) = (${table.period} is not null) and (${table.period} is null or ${table.period} in (${sql.raw(inList(FEE_PERIODS))}))`,
    ),
    check(
      "fund_fees_component_ck",
      sql`${table.component} is null or ${table.component} in (${sql.raw(inList(PAYROLL_COMPONENTS))})`,
    ),
    check(
      "fund_fees_validity_ck",
      sql`${table.validTo} is null or ${table.validFrom} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check("fund_fees_note_ck", sql`${table.note} is null or length(${table.note}) <= 300`),
  ],
);

/**
 * An operation of the fund: the one register of the money that enters and leaves it. Its class,
 * the period it is for, the components, the fee and the net. Written by hand, by the job that
 * finds a recurring debit among the movements (`source = rule`), or — before release N6 — read from
 * a document (`source = import`, kept as history). `origin_key` keeps one row per origin.
 */
export const fundOperations = pgTable(
  "fund_operations",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    originKey: text("origin_key").notNull(),
    originalType: text("original_type").notNull(),
    classification: text("classification", { enum: OPERATION_CLASSES }).notNull(),
    originalState: text("original_state"),
    competenceYear: smallint("competence_year"),
    competenceQuarter: smallint("competence_quarter"),
    operationDate: date("operation_date").notNull(),
    workerCents: money("worker_cents")
      .notNull()
      .default(sql`0`),
    employerCents: money("employer_cents")
      .notNull()
      .default(sql`0`),
    tfrCents: money("tfr_cents")
      .notNull()
      .default(sql`0`),
    otherCents: money("other_cents")
      .notNull()
      .default(sql`0`),
    feesCents: money("fees_cents")
      .notNull()
      .default(sql`0`),
    netCents: money("net_cents").notNull(),
    employerTaxCode: text("employer_tax_code"),
    employerName: text("employer_name"),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    source: text("source", { enum: OPERATION_SOURCES }).notNull(),
    /** The contribution source the operation belongs to; `null` for one that belongs to none. */
    sourceId: uuid("source_id").references(() => fundContributionSources.id, { onDelete: "set null" }),
    /** True while nobody has said what the operation cost: `fees_cents` is then 0 and not a fee. */
    feesUnknown: boolean("fees_unknown").notNull().default(false),
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    unique("fund_operations_origin_uq").on(table.fundId, table.originKey),
    unique("fund_operations_transaction_uq").on(table.transactionId),
    index("fund_operations_fund_idx").on(table.fundId, table.operationDate),
    index("fund_operations_document_idx").on(table.documentId),
    index("fund_operations_source_idx").on(table.sourceId),
    check(
      "fund_operations_class_ck",
      sql`${table.classification} in (${sql.raw(inList(OPERATION_CLASSES))})`,
    ),
    check("fund_operations_source_ck", sql`${table.source} in (${sql.raw(inList(OPERATION_SOURCES))})`),
    check(
      "fund_operations_quarter_ck",
      // The period within its year: a quarter (1-4) or, for a source that accrues by month, a month.
      sql`(${table.competenceYear} is null) = (${table.competenceQuarter} is null) and (${table.competenceQuarter} is null or ${table.competenceQuarter} between 1 and 12)`,
    ),
    check("fund_operations_fees_ck", sql`${table.feesCents} >= 0`),
    check("fund_operations_note_ck", sql`${table.note} is null or length(${table.note}) <= 200`),
  ],
);

/**
 * A movement of units under an operation (spec §6; GC §5, §10): compartment, units, unit price and
 * its date. An operation over several compartments has several; its header amounts stay once.
 */
export const unitMovements = pgTable(
  "unit_movements",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    operationId: uuid("operation_id")
      .notNull()
      .references(() => fundOperations.id, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    compartment: text("compartment").notNull(),
    units: numeric("units", { precision: 18, scale: 6 }).notNull(),
    unitPrice: numeric("unit_price", { precision: 14, scale: 6 }),
    unitPriceDate: date("unit_price_date"),
    ...timestamps,
  },
  (table) => [
    unique("unit_movements_position_uq").on(table.operationId, table.position),
    check("unit_movements_price_ck", sql`${table.unitPrice} is null or ${table.unitPrice} >= 0`),
  ],
);

/**
 * The position as a statement printed it (spec §6; GC §8.5): the value at its date and the
 * summary beside it. The value itself lives in the `import` balance of the valuation account (one
 * source, as for every value); this row points at it and goes with it.
 */
export const positionSnapshots = pgTable(
  "position_snapshots",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    balanceEntryId: uuid("balance_entry_id")
      .notNull()
      .references(() => balanceEntries.id, { onDelete: "cascade" }),
    valuationDate: date("valuation_date").notNull(),
    valueCents: money("value_cents").notNull(),
    tfrCents: money("tfr_cents"),
    workerCents: money("worker_cents"),
    employerCents: money("employer_cents"),
    transfersInCents: money("transfers_in_cents"),
    inflowsCents: money("inflows_cents"),
    advancesCents: money("advances_cents"),
    redemptionsCents: money("redemptions_cents"),
    ritaCents: money("rita_cents"),
    outflowsCents: money("outflows_cents"),
    reportedGainCents: money("reported_gain_cents"),
    ...timestamps,
  },
  (table) => [
    unique("position_snapshots_date_uq").on(table.fundId, table.valuationDate),
    unique("position_snapshots_entry_uq").on(table.balanceEntryId),
  ],
);

/**
 * A reviewer's word on one quarter × component (spec §6; GC §10–11): the competences and
 * operations it was about, the amounts and the difference then, and the decision with its note.
 * A decision holds while the difference is the one decided on; a new import that changes it puts
 * the quarter back in front of the reviewer. Nothing here ever becomes a "fee" to balance the books.
 */
export const reconciliationLinks = pgTable(
  "reconciliation_links",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
    year: smallint("year").notNull(),
    quarter: smallint("quarter").notNull(),
    component: text("component", { enum: COMPONENTS }).notNull(),
    competenceIds: uuid("competence_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    operationIds: uuid("operation_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    accruedCents: money("accrued_cents"),
    creditedCents: money("credited_cents"),
    differenceCents: money("difference_cents").notNull(),
    decision: text("decision", { enum: DECISIONS }).notNull(),
    note: text("note").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    unique("reconciliation_links_key_uq").on(table.fundId, table.year, table.quarter, table.component),
    check("reconciliation_links_quarter_ck", sql`${table.quarter} between 1 and 12`),
    check("reconciliation_links_component_ck", sql`${table.component} in (${sql.raw(inList(COMPONENTS))})`),
    check("reconciliation_links_decision_ck", sql`${table.decision} in (${sql.raw(inList(DECISIONS))})`),
    check("reconciliation_links_note_ck", sql`length(btrim(${table.note})) between 1 and 500`),
  ],
);

/** Before N6: the published tariff of a provider. Now rows of `fund_fees`. Not read; removed in R5f. */
export const fundFeeTariffs = pgTable(
  "fund_fee_tariffs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    provider: text("provider").notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    item: text("item").notNull(),
    amountCents: money("amount_cents"),
    rate: numeric("rate", { precision: 8, scale: 6 }),
    unit: text("unit").notNull(),
    note: text("note"),
    sourceUrl: text("source_url").notNull(),
    ...timestamps,
  },
  (table) => [
    unique("fund_fee_tariffs_item_uq").on(table.provider, table.item, table.validFrom),
    check("fund_fee_tariffs_value_ck", sql`(${table.amountCents} is null) <> (${table.rate} is null)`),
  ],
);
