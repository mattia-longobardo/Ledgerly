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
import {
  COMPONENTS,
  DECISIONS,
  OPERATION_CLASSES,
  OPERATION_SOURCES,
  PENSION_RULE_KINDS,
  type ScheduleEntry,
} from "./pension/rules";
import { DEPOSIT_SOURCES, FUND_STATES, FUND_TYPES, VALUATION_SOURCES } from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * A fund (spec §6, §7.7): a PAC in F4, a pension fund from F6. Its value is the balance of its
 * valuation account, so net worth has one source. `monthly_cents` and `deposit_fee_cents` come from
 * the design (plan F4 §3.6.4): the plan's instalment, and the fixed fee taken on each deposit.
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
    type: text("type", { enum: FUND_TYPES }).notNull(),
    provider: text("provider"),
    isin: text("isin"),
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
    check("funds_type_ck", sql`${table.type} in (${sql.raw(inList(FUND_TYPES))})`),
    check("funds_state_ck", sql`${table.state} in (${sql.raw(inList(FUND_STATES))})`),
    check("funds_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
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

/**
 * A PAC deposit (spec §7.7): what was debited, the fee, and what was invested — computed, never
 * typed, and unknown while the fee is. A movement pays one deposit only.
 */
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
    source: text("source", { enum: DEPOSIT_SOURCES }).notNull().default("manual"),
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
    check("fund_deposits_source_ck", sql`${table.source} in (${sql.raw(inList(DEPOSIT_SOURCES))})`),
    check("fund_deposits_charged_ck", sql`${table.chargedCents} > 0`),
    check(
      "fund_deposits_fee_ck",
      sql`${table.feeCents} is null or (${table.feeCents} >= 0 and ${table.feeCents} <= ${table.chargedCents})`,
    ),
  ],
);

/** The movements that become deposits by themselves (spec §7.7): one rule per fund, switchable. */
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
 * A pension rule with its validity (spec §6; GC §3.2, §4, §10): the contribution percentages of
 * the contract, shown and never used to rewrite a payslip (plan F6 §3.6.6), or the schedule of the
 * quarterly payments with the display tolerance kept apart from the due date.
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
    kind: text("kind", { enum: PENSION_RULE_KINDS }).notNull(),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    ccnl: text("ccnl"),
    base: text("base"),
    workerPct: numeric("worker_pct", { precision: 7, scale: 4 }),
    employerPct: numeric("employer_pct", { precision: 7, scale: 4 }),
    tfrPct: numeric("tfr_pct", { precision: 7, scale: 4 }),
    schedule: jsonb("schedule").$type<ScheduleEntry[]>(),
    toleranceDays: smallint("tolerance_days").notNull().default(15),
    source: text("source"),
    verifiedOn: date("verified_on"),
    ...timestamps,
  },
  (table) => [
    index("pension_rules_fund_idx").on(table.fundId, table.kind, table.validFrom),
    check("pension_rules_kind_ck", sql`${table.kind} in (${sql.raw(inList(PENSION_RULE_KINDS))})`),
    check(
      "pension_rules_validity_ck",
      sql`${table.validTo} is null or ${table.validTo} >= ${table.validFrom}`,
    ),
    check("pension_rules_tolerance_ck", sql`${table.toleranceDays} between 0 and 120`),
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
 * An operation of the fund (spec §6, §7.7; GC §8.4, §10): the provider's description and state
 * kept beside the interpretation, the competence quarter, the components, fees and net. Imported
 * from an export (`origin_key` = the fingerprint that deduplicates overlapping exports, plan F6
 * §3.4.4) or entered by hand (a voluntary contribution, linkable to a movement like a PAC deposit).
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
    note: text("note"),
    ...timestamps,
  },
  (table) => [
    unique("fund_operations_origin_uq").on(table.fundId, table.originKey),
    unique("fund_operations_transaction_uq").on(table.transactionId),
    index("fund_operations_fund_idx").on(table.fundId, table.operationDate),
    index("fund_operations_document_idx").on(table.documentId),
    check(
      "fund_operations_class_ck",
      sql`${table.classification} in (${sql.raw(inList(OPERATION_CLASSES))})`,
    ),
    check("fund_operations_source_ck", sql`${table.source} in (${sql.raw(inList(OPERATION_SOURCES))})`),
    check(
      "fund_operations_quarter_ck",
      sql`(${table.competenceYear} is null) = (${table.competenceQuarter} is null) and (${table.competenceQuarter} is null or ${table.competenceQuarter} between 1 and 4)`,
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
 * source, as for a PAC); this row points at it and goes with it.
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
    check("reconciliation_links_quarter_ck", sql`${table.quarter} between 1 and 4`),
    check("reconciliation_links_component_ck", sql`${table.component} in (${sql.raw(inList(COMPONENTS))})`),
    check("reconciliation_links_decision_ck", sql`${table.decision} in (${sql.raw(inList(DECISIONS))})`),
    check("reconciliation_links_note_ck", sql`length(btrim(${table.note})) between 1 and 500`),
  ],
);

/**
 * A provider's published tariff (spec §6; GC §6.1): public, not anyone's data, seeded by the
 * migration and versioned by validity. It explains the fees; the imported charges are what count.
 */
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
