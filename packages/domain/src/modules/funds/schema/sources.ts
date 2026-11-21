// Funds · the tables of the sources of contributions and of the fees.
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
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";
import { createdAtColumn, idColumn, updatedAtColumn } from "../../../platform/db/columns";
import { FEE_BASES, FEE_PERIODS } from "../../../shared/fees";
import { accounts } from "../../accounts/schema";
import {
  ACCRUAL_PERIODS,
  type DueEntry,
  INTERVAL_UNITS,
  PAYROLL_COMPONENTS,
  SOURCE_KINDS,
  SOURCE_STATES,
} from "../sources";
import { funds } from "./funds";

export const fundContributionSources = pgTable(
  "fund_contribution_sources",
  {
    id: idColumn(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
    id: idColumn(),
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
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
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
