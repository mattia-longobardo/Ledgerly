import { sql } from "drizzle-orm";
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
  text,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { createdAtColumn, idColumn, moment, updatedAtColumn } from "../../platform/db/columns";
import { users } from "../../platform/auth/schema";
import { integrationConnections } from "../../platform/integrations/schema";
import { accounts } from "../accounts/schema";
import { transactions } from "../transactions/schema";
import {
  ADJUSTMENT_CLASSES,
  ASSET_CLASSES,
  EVENT_ORIGINS,
  HOLDING_ORIGINS,
  INVESTMENT_CATEGORIES,
  LEGS,
  MODES,
  NEGATIVE_KINDS,
  OPERATION_KINDS,
  ORIGINS,
  PLAN_FREQUENCIES,
  PLAN_MODES,
  PLAN_RECORDERS,
  PLAN_RUN_STATES,
  PLAN_STATES,
  PERIOD_REASONS,
  POSITIVE_KINDS,
  PRICE_SOURCES,
  COVERAGE_STATUSES,
  KEY_CHECK_ORIGINS,
  KEY_CHECK_RESULTS,
  PRODUCT_PATTERN,
  QUANTITY_BASES,
  READING_STATUSES,
  RECONCILIATION_KINDS,
} from "./rules";
import { inList } from "../../platform/db/checks";

// ——— Investments v2 (docs/design/investments.md §1.3–1.6) ————————————————————————————————————

const quantity = (name: string) => numeric(name, { precision: 38, scale: 18 });
const price = (name: string) => numeric(name, { precision: 30, scale: 12 });
const rate = (name: string) => numeric(name, { precision: 20, scale: 10 });
const currencyCheck = (name: string, column: unknown) => check(name, sql`${column} ~ '^[A-Z]{3}$'`);

/**
 * A service of the section (§1.3): one row per `accounts` row of type `investment` or `crypto`, the
 * account its value is written to. From `managed_since` this module is the account's only writer,
 * with the `portfolio` source.
 */
export const investmentAccounts = pgTable(
  "investment_accounts",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    category: text("category", { enum: INVESTMENT_CATEGORIES }).notNull(),
    provider: text("provider").notNull(),
    managedSince: date("managed_since").notNull(),
    url: text("url"),
    openedOn: date("opened_on"),
    closedOn: date("closed_on"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("investment_accounts_account_uq").on(table.accountId),
    index("investment_accounts_user_idx").on(table.userId),
    check(
      "investment_accounts_category_ck",
      sql`${table.category} in (${sql.raw(inList(INVESTMENT_CATEGORIES))})`,
    ),
    check("investment_accounts_provider_ck", sql`length(${table.provider}) between 1 and 40`),
    check(
      "investment_accounts_url_ck",
      sql`${table.url} is null or (${table.url} ~ '^https?://' and length(${table.url}) <= 500)`,
    ),
  ],
);

/**
 * Mode and origin through time (A3): a new row at every conversion, the old ones untouched. A
 * period starts at `starts_at` inside its first day, so the events of that day ordered before the
 * conversion still belong to the period before.
 */
export const investmentAccountPeriods = pgTable(
  "investment_account_periods",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    fromOn: date("from_on").notNull(),
    startsAt: moment("starts_at").notNull(),
    mode: text("mode", { enum: MODES }).notNull(),
    origin: text("origin", { enum: ORIGINS }).notNull(),
    reason: text("reason", { enum: PERIOD_REASONS }).notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("investment_account_periods_start_uq").on(table.investmentAccountId, table.startsAt),
    index("investment_account_periods_user_idx").on(table.userId),
    check("investment_account_periods_mode_ck", sql`${table.mode} in (${sql.raw(inList(MODES))})`),
    check("investment_account_periods_origin_ck", sql`${table.origin} in (${sql.raw(inList(ORIGINS))})`),
    check(
      "investment_account_periods_reason_ck",
      sql`${table.reason} in (${sql.raw(inList(PERIOD_REASONS))})`,
    ),
  ],
);

/** The assets a person can hold (§1.4): a seed they can change, plus what they add. */
export const investmentAssets = pgTable(
  "investment_assets",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    class: text("class", { enum: ASSET_CLASSES }).notNull(),
    name: text("name").notNull(),
    isin: text("isin"),
    symbol: text("symbol"),
    mic: text("mic"),
    currency: text("currency").notNull(),
    priceSource: text("price_source", { enum: PRICE_SOURCES }).notNull().default("manual"),
    /**
     * The instrument of the registry (R5d); null for an asset typed by hand outside it. No foreign
     * key: the registry is another module's (M2), and it never deletes an instrument.
     */
    instrumentId: uuid("instrument_id"),
    archivedAt: moment("archived_at"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    uniqueIndex("investment_assets_isin_uq")
      .on(table.userId, table.isin)
      .where(sql`${table.isin} is not null`),
    index("investment_assets_instrument_idx").on(table.instrumentId),
    uniqueIndex("investment_assets_symbol_uq")
      .on(table.userId, table.class, table.symbol, sql`coalesce(${table.mic}, '')`)
      .where(sql`${table.symbol} is not null`),
    check("investment_assets_class_ck", sql`${table.class} in (${sql.raw(inList(ASSET_CLASSES))})`),
    check("investment_assets_name_ck", sql`length(btrim(${table.name})) between 1 and 120`),
    check(
      "investment_assets_isin_ck",
      sql`${table.isin} is null or ${table.isin} ~ '^[A-Z]{2}[A-Z0-9]{9}[0-9]$'`,
    ),
    check(
      "investment_assets_symbol_ck",
      sql`${table.symbol} is null or length(btrim(${table.symbol})) between 1 and 20`,
    ),
    check("investment_assets_mic_ck", sql`${table.mic} is null or ${table.mic} ~ '^[A-Z0-9]{4}$'`),
    currencyCheck("investment_assets_currency_ck", table.currency),
    check(
      "investment_assets_price_source_ck",
      sql`${table.priceSource} in (${sql.raw(inList(PRICE_SOURCES))})`,
    ),
  ],
);

/**
 * A position of an asset in an account (§1.4). Quantity, cost and state are no columns: they come
 * from the operations and reconciliations at a date (A2).
 */
export const investmentHoldings = pgTable(
  "investment_holdings",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "restrict" }),
    origin: text("origin", { enum: HOLDING_ORIGINS }).notNull(),
    product: text("product").notNull(),
    openedOn: date("opened_on").notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique("investment_holdings_uq").on(
      table.investmentAccountId,
      table.assetId,
      table.origin,
      table.product,
    ),
    index("investment_holdings_user_idx").on(table.userId),
    check("investment_holdings_origin_ck", sql`${table.origin} in (${sql.raw(inList(HOLDING_ORIGINS))})`),
    check("investment_holdings_product_ck", sql`${table.product} ~ ${sql.raw(`'${PRODUCT_PATTERN}'`)}`),
  ],
);

/** The unit of idempotency (A6): a trade, a deposit, a ledger line, or a person's action. */
export const investmentEvents = pgTable(
  "investment_events",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    occurredAt: moment("occurred_at").notNull(),
    on: date("on").notNull(),
    seq: bigint("seq", { mode: "bigint" }).notNull().generatedAlwaysAsIdentity(),
    origin: text("origin", { enum: EVENT_ORIGINS }).notNull(),
    transferGroupId: uuid("transfer_group_id"),
    transactionId: uuid("transaction_id").references(() => transactions.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("investment_events_transaction_uq").on(table.transactionId),
    index("investment_events_account_on_idx").on(table.investmentAccountId, table.on),
    index("investment_events_user_idx").on(table.userId),
    check("investment_events_origin_ck", sql`${table.origin} in (${sql.raw(inList(EVENT_ORIGINS))})`),
    check(
      "investment_events_note_ck",
      sql`${table.note} is null or length(btrim(${table.note})) between 1 and 200`,
    ),
  ],
);

/** The legs of an event (§1.5); `amount_cents` is signed by kind, in the account's currency. */
export const investmentOperations = pgTable(
  "investment_operations",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => investmentEvents.id, { onDelete: "cascade" }),
    leg: text("leg", { enum: LEGS }).notNull(),
    holdingId: uuid("holding_id").references(() => investmentHoldings.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: OPERATION_KINDS }).notNull(),
    quantity: quantity("quantity"),
    unitPrice: price("unit_price"),
    priceCurrency: text("price_currency"),
    nativeAmount: price("native_amount"),
    nativeCurrency: text("native_currency"),
    fxRate: rate("fx_rate"),
    fxSource: text("fx_source"),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    validUntil: date("valid_until"),
    quantityBasis: text("quantity_basis", { enum: QUANTITY_BASES }).notNull().default("reported"),
    /** What a correction (R3) stands for (docs/design/investments-ux.md §4.9); `null` = `data`. */
    adjustmentClass: text("adjustment_class", { enum: ADJUSTMENT_CLASSES }),
    /** The instalment of a purchase plan this purchase is (R5d): one purchase a due date. */
    planRunId: uuid("plan_run_id").references((): AnyPgColumn => investmentPlanRuns.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique("investment_operations_leg_uq").on(table.eventId, table.leg),
    unique("investment_operations_plan_run_uq").on(table.planRunId),
    index("investment_operations_holding_idx").on(table.holdingId),
    index("investment_operations_user_idx").on(table.userId),
    check("investment_operations_leg_ck", sql`${table.leg} in (${sql.raw(inList(LEGS))})`),
    check("investment_operations_kind_ck", sql`${table.kind} in (${sql.raw(inList(OPERATION_KINDS))})`),
    check(
      "investment_operations_basis_ck",
      sql`${table.quantityBasis} in (${sql.raw(inList(QUANTITY_BASES))})`,
    ),
    check(
      "investment_operations_sign_ck",
      sql`(${table.kind} not in (${sql.raw(inList(POSITIVE_KINDS))}) or ${table.amountCents} >= 0) and (${table.kind} not in (${sql.raw(inList(NEGATIVE_KINDS))}) or ${table.amountCents} <= 0)`,
    ),
    check("investment_operations_quantity_ck", sql`${table.quantity} is null or ${table.quantity} > 0`),
    check("investment_operations_price_ck", sql`${table.unitPrice} is null or ${table.unitPrice} >= 0`),
    check(
      "investment_operations_valid_until_ck",
      sql`${table.validUntil} is null or ${table.kind} = 'adjustment'`,
    ),
    check(
      "investment_operations_adjustment_class_ck",
      sql`${table.adjustmentClass} is null or (${table.kind} = 'adjustment' and ${table.adjustmentClass} in (${sql.raw(inList(ADJUSTMENT_CLASSES))}))`,
    ),
    check(
      "investment_operations_price_currency_ck",
      sql`${table.priceCurrency} is null or ${table.priceCurrency} ~ '^[A-Z]{3}$'`,
    ),
  ],
);

/** The version of a manual operation before a change or a deletion (A2). */
export const investmentOperationRevisions = pgTable(
  "investment_operation_revisions",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    // Deliberately no foreign keys: a revision outlives the operation it remembers.
    eventId: uuid("event_id").notNull(),
    operationId: uuid("operation_id"),
    changedAt: moment("changed_at").notNull().defaultNow(),
    before: jsonb("before").$type<Record<string, unknown>>().notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("investment_operation_revisions_event_idx").on(table.eventId, table.changedAt),
    index("investment_operation_revisions_user_idx").on(table.userId),
    check("investment_operation_revisions_reason_ck", sql`${table.reason} in ('edited', 'deleted')`),
  ],
);

/** What the provider reported at a sync (§1.6). Not a balance entry: the engine combines it. */
export const investmentReadings = pgTable(
  "investment_readings",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    observedAt: moment("observed_at").notNull(),
    status: text("status", { enum: READING_STATUSES }).notNull(),
    totalCents: bigint("total_cents", { mode: "bigint" }).notNull(),
    cashCents: bigint("cash_cents", { mode: "bigint" }),
    nativeTotal: price("native_total"),
    fxRate: rate("fx_rate"),
    fxSource: text("fx_source"),
    missingPrices: integer("missing_prices").notNull().default(0),
  },
  (table) => [
    unique("investment_readings_account_on_uq").on(table.investmentAccountId, table.on),
    index("investment_readings_user_idx").on(table.userId),
    check("investment_readings_status_ck", sql`${table.status} in (${sql.raw(inList(READING_STATUSES))})`),
    check("investment_readings_missing_ck", sql`${table.missingPrices} >= 0`),
  ],
);

/** The positions of a reading (A5), with their price and conversion path. */
export const investmentReadingPositions = pgTable(
  "investment_reading_positions",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => investmentReadings.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "restrict" }),
    product: text("product").notNull(),
    quantity: quantity("quantity").notNull(),
    price: price("price"),
    priceCurrency: text("price_currency"),
    priceAt: moment("price_at"),
    priceSource: text("price_source"),
    fxRate: rate("fx_rate"),
    fxSource: text("fx_source"),
    valueCents: bigint("value_cents", { mode: "bigint" }),
    /** What the position cost, in the account's currency, when the provider says (eToro `amount`, U4). */
    costCents: bigint("cost_cents", { mode: "bigint" }),
  },
  (table) => [
    index("investment_reading_positions_reading_idx").on(table.readingId),
    index("investment_reading_positions_user_idx").on(table.userId),
    check(
      "investment_reading_positions_product_ck",
      sql`${table.product} ~ ${sql.raw(`'${PRODUCT_PATTERN}'`)}`,
    ),
  ],
);

/** What a reading covers (A1): an external account and product, complete or not. */
export const investmentReadingScopes = pgTable(
  "investment_reading_scopes",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => investmentReadings.id, { onDelete: "cascade" }),
    externalAccountId: text("external_account_id").notNull(),
    product: text("product").notNull(),
    complete: boolean("complete").notNull(),
  },
  (table) => [
    unique("investment_reading_scopes_uq").on(table.readingId, table.externalAccountId, table.product),
    index("investment_reading_scopes_user_idx").on(table.userId),
    check("investment_reading_scopes_product_ck", sql`${table.product} ~ ${sql.raw(`'${PRODUCT_PATTERN}'`)}`),
  ],
);

/** Dated decisions on a manual position the provider may cover (A1, A2): never a state change. */
export const investmentReconciliations = pgTable(
  "investment_reconciliations",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    holdingId: uuid("holding_id")
      .notNull()
      .references(() => investmentHoldings.id, { onDelete: "cascade" }),
    effectiveOn: date("effective_on").notNull(),
    kind: text("kind", { enum: RECONCILIATION_KINDS }).notNull(),
    quantity: quantity("quantity"),
    readingId: uuid("reading_id").references(() => investmentReadings.id, { onDelete: "set null" }),
    decidedAt: moment("decided_at").notNull().defaultNow(),
    note: text("note"),
  },
  (table) => [
    index("investment_reconciliations_holding_idx").on(table.holdingId, table.effectiveOn),
    index("investment_reconciliations_user_idx").on(table.userId),
    check(
      "investment_reconciliations_kind_ck",
      sql`${table.kind} in (${sql.raw(inList(RECONCILIATION_KINDS))})`,
    ),
    check(
      "investment_reconciliations_quantity_ck",
      sql`(${table.kind} = 'partial') = (${table.quantity} is not null)`,
    ),
  ],
);

/**
 * The balance entries a handover removed (§1.3, A4): kept with their reason, so the rollback can
 * put them back and nothing a person typed is ever lost.
 */
export const investmentSupersededEntries = pgTable(
  "investment_superseded_entries",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    balanceEntryId: uuid("balance_entry_id").notNull(),
    on: date("on").notNull(),
    balanceCents: bigint("balance_cents", { mode: "bigint" }).notNull(),
    availableCents: bigint("available_cents", { mode: "bigint" }),
    source: text("source").notNull(),
    note: text("note"),
    capturedAt: moment("captured_at").notNull(),
    supersededAt: moment("superseded_at").notNull().defaultNow(),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("investment_superseded_entries_account_idx").on(table.accountId, table.on),
    index("investment_superseded_entries_user_idx").on(table.userId),
  ],
);

// ——— Provider sync (docs/design/investments.md §1.2, §1.6; phase 3) ————————————————————————————

/**
 * What a key check found (SEC-01, SEC-07, D7): one row per check, never the key. `connection_id`
 * outlives the connection as null, so after a disconnection the page can still ask for the key to
 * be revoked at the provider; `retired_at` says the key is no longer the connection's.
 */
export const investmentKeyChecks = pgTable(
  "investment_key_checks",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id").references(() => integrationConnections.id, { onDelete: "set null" }),
    provider: text("provider").notNull(),
    origin: text("origin", { enum: KEY_CHECK_ORIGINS }).notNull(),
    checkedAt: moment("checked_at").notNull().defaultNow(),
    result: text("result", { enum: KEY_CHECK_RESULTS }).notNull(),
    permissions: jsonb("permissions").$type<Record<string, boolean>>().notNull().default({}),
    ipRestricted: boolean("ip_restricted"),
    attestedReadOnlyAt: moment("attested_read_only_at"),
    attestedIpAt: moment("attested_ip_at"),
    attestationTextVersion: text("attestation_text_version"),
    retiredAt: moment("retired_at"),
    revokedAtProviderAt: moment("revoked_at_provider_at"),
  },
  (table) => [
    index("investment_key_checks_account_idx").on(table.investmentAccountId, table.checkedAt),
    index("investment_key_checks_user_idx").on(table.userId),
    check("investment_key_checks_result_ck", sql`${table.result} in (${sql.raw(inList(KEY_CHECK_RESULTS))})`),
    check("investment_key_checks_origin_ck", sql`${table.origin} in (${sql.raw(inList(KEY_CHECK_ORIGINS))})`),
    check("investment_key_checks_provider_ck", sql`length(${table.provider}) between 1 and 40`),
  ],
);

/**
 * What the flows and the history of a connection cover (A7): windows per stream, rewritten with the
 * data they describe in one transaction. The UI and the return read this, not the run's outcome.
 */
export const investmentSyncCoverage = pgTable(
  "investment_sync_coverage",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    stream: text("stream").notNull(),
    fromAt: moment("from_at").notNull(),
    toAt: moment("to_at").notNull(),
    status: text("status", { enum: COVERAGE_STATUSES }).notNull(),
    reason: text("reason"),
  },
  (table) => [
    unique("investment_sync_coverage_window_uq").on(table.connectionId, table.stream, table.fromAt),
    index("investment_sync_coverage_user_idx").on(table.userId),
    check("investment_sync_coverage_kind_ck", sql`${table.kind} in ('holdings', 'flows')`),
    check(
      "investment_sync_coverage_status_ck",
      sql`${table.status} in (${sql.raw(inList(COVERAGE_STATUSES))})`,
    ),
    check("investment_sync_coverage_stream_ck", sql`${table.stream} ~ '^[a-z][a-z0-9_:/-]{0,59}$'`),
    check("investment_sync_coverage_window_ck", sql`${table.toAt} >= ${table.fromAt}`),
    check(
      "investment_sync_coverage_reason_ck",
      sql`${table.reason} is null or ${table.reason} ~ '^[a-z][a-z0-9_]{0,59}$'`,
    ),
  ],
);

// ——— Purchase plans (R5d, step 2; 11-standardization.md §11.3) ———————————————————————————————

/**
 * A purchase plan of a manual portfolio: one asset bought for an amount (in the asset's currency) or a
 * quantity at each due date. It writes purchases only (P1 B): its debit account finds the movement.
 */
export const investmentPlans = pgTable(
  "investment_plans",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    investmentAccountId: uuid("investment_account_id")
      .notNull()
      .references(() => investmentAccounts.id, { onDelete: "cascade" }),
    assetId: uuid("asset_id")
      .notNull()
      .references(() => investmentAssets.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }),
    quantity: quantity("quantity"),
    fractions: boolean("fractions").notNull().default(true),
    frequency: text("frequency", { enum: PLAN_FREQUENCIES }).notNull(),
    interval: integer("interval").notNull().default(1),
    day: integer("day").notNull(),
    startOn: date("start_on").notNull(),
    endOn: date("end_on"),
    runsLimit: integer("runs_limit"),
    debitAccountId: uuid("debit_account_id").references(() => accounts.id, { onDelete: "set null" }),
    feeCents: bigint("fee_cents", { mode: "bigint" }),
    feeRate: rate("fee_rate"),
    mode: text("mode", { enum: PLAN_MODES }).notNull().default("propose"),
    state: text("state", { enum: PLAN_STATES }).notNull().default("active"),
    /** The first day the job looks at: the due dates before it are «Record the past instalments» (P4). */
    createdOn: date("created_on").notNull(),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    index("investment_plans_account_idx").on(table.investmentAccountId),
    index("investment_plans_user_idx").on(table.userId),
    check("investment_plans_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check(
      "investment_plans_size_ck",
      sql`(${table.amountCents} is null) <> (${table.quantity} is null) and (${table.amountCents} is null or ${table.amountCents} > 0) and (${table.quantity} is null or ${table.quantity} > 0)`,
    ),
    check("investment_plans_frequency_ck", sql`${table.frequency} in (${sql.raw(inList(PLAN_FREQUENCIES))})`),
    check("investment_plans_interval_ck", sql`${table.interval} between 1 and 12`),
    check(
      "investment_plans_day_ck",
      sql`${table.day} between 1 and (case when ${table.frequency} = 'week' then 7 else 31 end)`,
    ),
    check("investment_plans_end_ck", sql`${table.endOn} is null or ${table.runsLimit} is null`),
    check(
      "investment_plans_runs_ck",
      sql`${table.runsLimit} is null or ${table.runsLimit} between 1 and 600`,
    ),
    check(
      "investment_plans_fee_ck",
      sql`(${table.feeCents} is null or ${table.feeCents} >= 0) and (${table.feeRate} is null or ${table.feeRate} >= 0) and (${table.feeCents} is null or ${table.feeRate} is null)`,
    ),
    check("investment_plans_mode_ck", sql`${table.mode} in (${sql.raw(inList(PLAN_MODES))})`),
    check("investment_plans_state_ck", sql`${table.state} in (${sql.raw(inList(PLAN_STATES))})`),
  ],
);

/** A due date of a plan, and what came of it: one row a date (the job may run twice). */
export const investmentPlanRuns = pgTable(
  "investment_plan_runs",
  {
    id: idColumn(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => investmentPlans.id, { onDelete: "cascade" }),
    dueOn: date("due_on").notNull(),
    state: text("state", { enum: PLAN_RUN_STATES }).notNull().default("pending"),
    /** The close it is priced at, its currency and its day: the first on or after the due date. */
    price: price("price"),
    priceCurrency: text("price_currency"),
    priceOn: date("price_on"),
    waitingSince: date("waiting_since"),
    /** Why the job did not write an `auto` instalment (P2): a refusal of the purchase. */
    reason: text("reason"),
    recordedBy: text("recorded_by", { enum: PLAN_RECORDERS }),
    /** The movement of the debit account the matcher proposed (E7), and whether the person linked it. */
    debitTransactionId: uuid("debit_transaction_id").references(() => transactions.id, {
      onDelete: "set null",
    }),
    debitLinked: boolean("debit_linked").notNull().default(false),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
  },
  (table) => [
    unique("investment_plan_runs_due_uq").on(table.planId, table.dueOn),
    index("investment_plan_runs_user_idx").on(table.userId),
    check("investment_plan_runs_state_ck", sql`${table.state} in (${sql.raw(inList(PLAN_RUN_STATES))})`),
    check("investment_plan_runs_price_ck", sql`${table.price} is null or ${table.price} > 0`),
    check(
      "investment_plan_runs_recorded_ck",
      sql`${table.recordedBy} is null or ${table.recordedBy} in (${sql.raw(inList(PLAN_RECORDERS))})`,
    ),
    check("investment_plan_runs_reason_ck", sql`${table.reason} is null or length(${table.reason}) <= 40`),
  ],
);
