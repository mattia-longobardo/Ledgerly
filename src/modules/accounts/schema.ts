import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../platform/auth/schema";
import {
  ACCOUNT_ORIGINS,
  ACCOUNT_STATES,
  ACCOUNT_TYPES,
  ENTRY_SOURCES,
  CONNECTION_CHANNELS,
  REMINDERS,
  SNAPSHOT_STATES,
  TRENDS,
} from "./rules";

const inList = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

export const accountGroups = pgTable(
  "account_groups",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [unique("account_groups_user_name_uq").on(table.userId, table.name)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => accountGroups.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    type: text("type", { enum: ACCOUNT_TYPES }).notNull(),
    currency: text("currency").notNull().default("EUR"),
    origin: text("origin", { enum: ACCOUNT_ORIGINS }).notNull().default("manual"),
    provider: text("provider"),
    providerAccountId: text("provider_account_id"),
    state: text("state", { enum: ACCOUNT_STATES }).notNull().default("active"),
    color: text("color"),
    reference: text("reference"),
    // The account's IBAN (rewrite plan N4, H39): compact and upper case, checked. Written by the
    // source when it gives one (`ibanFromSource`, read-only for the person), or by hand. One IBAN,
    // one account: the services check it, not an index (04-now.md §4.6.1, point 2). Never leaves
    // Ledgerly through the API, MCP, an export or a log (H45).
    iban: text("iban"),
    ibanFromSource: boolean("iban_from_source").notNull().default(false),
    purpose: text("purpose"),
    openedOn: date("opened_on"),
    sortOrder: integer("sort_order").notNull().default(0),
    inNetWorth: boolean("in_net_worth").notNull().default(true),
    inSnapshot: boolean("in_snapshot").notNull().default(true),
    countsAsLiquid: boolean("counts_as_liquid").notNull().default(false),
    lowBalanceCents: bigint("low_balance_cents", { mode: "bigint" }),
    staleAfterHours: smallint("stale_after_hours").notNull().default(36),
    reminder: text("reminder", { enum: REMINDERS }).notNull().default("never"),
    betweenEntries: text("between_entries", { enum: TRENDS }).notNull().default("hold"),
    renamedLocally: boolean("renamed_locally").notNull().default(false),
    /** The provider's type is followed until the type is changed here, like the name. */
    retypedLocally: boolean("retyped_locally").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    notes: text("notes"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("accounts_user_sort_idx").on(table.userId, table.sortOrder, table.id),
    unique("accounts_provider_uq").on(table.userId, table.provider, table.providerAccountId),
    check("accounts_type_ck", sql`${table.type} in (${sql.raw(inList(ACCOUNT_TYPES))})`),
    check("accounts_state_ck", sql`${table.state} in (${sql.raw(inList(ACCOUNT_STATES))})`),
    check("accounts_origin_ck", sql`${table.origin} in (${sql.raw(inList(ACCOUNT_ORIGINS))})`),
    check("accounts_reminder_ck", sql`${table.reminder} in (${sql.raw(inList(REMINDERS))})`),
    check("accounts_between_entries_ck", sql`${table.betweenEntries} in (${sql.raw(inList(TRENDS))})`),
    check("accounts_currency_ck", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("accounts_name_ck", sql`length(btrim(${table.name})) between 1 and 80`),
    check("accounts_stale_hours_ck", sql`${table.staleAfterHours} between 1 and 8760`),
    check("accounts_low_balance_ck", sql`${table.lowBalanceCents} is null or ${table.lowBalanceCents} >= 0`),
    check(
      "accounts_synced_provider_ck",
      sql`${table.origin} = 'manual' or (${table.provider} is not null and ${table.providerAccountId} is not null)`,
    ),
    check(
      "accounts_iban_ck",
      sql`${table.iban} is null or ${table.iban} ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'`,
    ),
    index("accounts_user_iban_idx")
      .on(table.userId, table.iban)
      .where(sql`${table.iban} is not null`),
    check("accounts_archived_ck", sql`(${table.state} = 'archived') = (${table.archivedAt} is not null)`),
  ],
);

export const balanceEntries = pgTable(
  "balance_entries",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    on: date("on").notNull(),
    balanceCents: bigint("balance_cents", { mode: "bigint" }).notNull(),
    availableCents: bigint("available_cents", { mode: "bigint" }),
    source: text("source", { enum: ENTRY_SOURCES }).notNull(),
    note: text("note"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("balance_entries_account_on_source_uq").on(table.accountId, table.on, table.source),
    index("balance_entries_account_on_idx").on(table.accountId, table.on.desc()),
    index("balance_entries_user_idx").on(table.userId),
    check("balance_entries_source_ck", sql`${table.source} in (${sql.raw(inList(ENTRY_SOURCES))})`),
  ],
);

/**
 * The accounts a person wrote a movement by hand on (rewrite plan, 12-account-modes.md §12.2): one
 * row while the account has one that counts. Kept by the rebuild of the balances after those
 * movements and read with the accounts it works on, so a balance written on an account with no
 * manual movement starts no rebuild and costs no read. A table of its own, not a column of
 * `accounts`: an account's row is what every screen and every snapshot of the numbers reads.
 */
export const manualMovementAccounts = pgTable(
  "manual_movement_accounts",
  {
    accountId: uuid("account_id")
      .primaryKey()
      .references(() => accounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("manual_movement_accounts_user_idx").on(table.userId)],
);

export const snapshotRuns = pgTable(
  "snapshot_runs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    month: date("month").notNull(),
    state: text("state", { enum: SNAPSHOT_STATES }).notNull(),
    accountsWritten: integer("accounts_written").notNull().default(0),
    accountsSkipped: integer("accounts_skipped").notNull().default(0),
    totalCents: bigint("total_cents", { mode: "bigint" }),
    // The display currency `total_cents` was summed in (§2.3): a past snapshot keeps its own, and is
    // never converted again when the preference changes.
    totalCurrency: text("total_currency").notNull().default("EUR"),
    warnings: jsonb("warnings").$type<string[]>(),
    ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    unique("snapshot_runs_user_month_uq").on(table.userId, table.month),
    index("snapshot_runs_user_month_idx").on(table.userId, table.month.desc()),
    check("snapshot_runs_state_ck", sql`${table.state} in (${sql.raw(inList(SNAPSHOT_STATES))})`),
    check("snapshot_runs_month_ck", sql`extract(day from ${table.month}) = 1`),
    check("snapshot_runs_total_currency_ck", sql`${table.totalCurrency} ~ '^[A-Z]{3}$'`),
  ],
);

/**
 * What hangs off an account: the direct debits and standing orders on its IBAN, and what is
 * charged to its card (spec §7.1, owner 2026-09-21). One row per thing, so the list can be
 * ordered, searched and — one day — tied to a subscription; a comma-separated memo could be none
 * of those.
 *
 * `ON DELETE CASCADE` on the account: a connection is a fact *about* that account and means
 * nothing without it. The unique key is case-insensitive on the name, so "Paypal" and "PayPal"
 * are the same connection on the same channel and the second one is refused rather than filed.
 */
export const accountConnections = pgTable(
  "account_connections",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    channel: text("channel", { enum: CONNECTION_CHANNELS }).notNull(),
    name: text("name").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex("account_connections_uq").on(table.accountId, table.channel, sql`lower(${table.name})`),
    index("account_connections_user_idx").on(table.userId, table.accountId),
    check(
      "account_connections_channel_ck",
      sql`${table.channel} in (${sql.raw(inList(CONNECTION_CHANNELS))})`,
    ),
    check("account_connections_name_ck", sql`length(btrim(${table.name})) between 1 and 60`),
  ],
);

/**
 * A switch of an account from one source to another (rewrite plan N4, 04-now.md §4.6.1 point 11):
 * what was there before, so "Undo switch" puts it back, with no limit of time (H42). One open switch
 * per account (`undone_at` null). The interest rules' modes before the switch are kept here as
 * opaque data of the interests module.
 */
export const accountSwitches = pgTable(
  "account_switches",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: uuid("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    fromProvider: text("from_provider").notNull(),
    fromProviderAccountId: text("from_provider_account_id").notNull(),
    toProvider: text("to_provider").notNull(),
    toProviderAccountId: text("to_provider_account_id").notNull(),
    /** The bank's connection the account now comes from. */
    connectionId: uuid("connection_id").notNull(),
    /** The last day the source before read: the history up to it stays the source's. */
    cutDate: date("cut_date").notNull(),
    /** The account had no IBAN and took the bank's: "Undo switch" takes it away again. */
    ibanTaken: boolean("iban_taken").notNull().default(false),
    interestModes: jsonb("interest_modes").$type<{ ruleId: string; mode: string }[]>().notNull().default([]),
    counts: jsonb("counts").$type<Record<string, number>>().notNull().default({}),
    /**
     * The account of the bank that was already here and that the switch joined to this one (H39 as
     * changed for already imported accounts): it is archived, kept by hand, and "Undo switch" gives
     * it back its bank. `null` for a switch to an account of the bank that was not here.
     */
    mergedAccountId: uuid("merged_account_id").references(() => accounts.id, { onDelete: "set null" }),
    /** The state the joined account had before (`active` or `unavailable`), for "Undo switch". */
    mergedState: text("merged_state"),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
    undoneAt: timestamp("undone_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("account_switches_open_uq")
      .on(table.accountId)
      .where(sql`${table.undoneAt} is null`),
    index("account_switches_user_idx").on(table.userId, table.appliedAt),
  ],
);
