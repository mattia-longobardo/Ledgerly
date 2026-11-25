// Funds · the tables of the register: operations, unit movements, positions, reconciliation, tariffs.
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../../platform/auth/schema";
import { inList } from "../../../platform/db/checks";
import { idColumn, moment } from "../../../platform/db/columns";
import { balanceEntries } from "../../accounts/schema";
import { transactions } from "../../transactions/schema";
import { COMPONENTS, DECISIONS, OPERATION_CLASSES, OPERATION_SOURCES } from "../pension/rules";
import { funds } from "./funds";
import { money, timestamps } from "./pension";
import { fundContributionSources } from "./sources";

export const fundOperations = pgTable(
  "fund_operations",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
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
    id: idColumn(),
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
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fundId: uuid("fund_id")
      .notNull()
      .references(() => funds.id, { onDelete: "cascade" }),
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
    id: idColumn(),
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
    decidedAt: moment("decided_at").notNull(),
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
