import type { AddonId } from "@ledgerly/api-contract";
/**
 * The vocabulary the integration tables are built on. Kept here rather than in `schema.ts` so the
 * tables and the pure rules that reason about them share one source (same split as
 * `modules/accounts/rules.ts`).
 */
import { z } from "zod";

export const CONNECTION_STATES = ["active", "error", "revoked"] as const;
/**
 * Every kind of pass any provider can make. A provider makes only its own (`KINDS_OF`): this list
 * is the column's vocabulary, not a to-do list anybody works through. `documents` has no provider
 * since the document pull was removed: it stays so the tables' check constraints need no migration.
 */
export const SYNC_KINDS = ["accounts", "transactions", "leave", "documents", "holdings", "flows"] as const;
export const SYNC_STATES = ["running", "success", "failed", "skipped"] as const;
/** Why an account of a source does not come here: left out by the person, or deleted here. */
export const SKIP_REASONS = ["excluded", "deleted"] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
/**
 * `category_group` is the group of a source's category, filed as the local parent category (F2.5);
 * `investment_event` and `investment_holding` are the provider ids of Investments (docs/design/
 * investments.md §1.2): the link sits on the event, never on one of its legs (A6).
 */
export const ENTITY_TYPES = [
  "account",
  "transaction",
  "category",
  "category_group",
  "interest_entry",
  "investment_event",
  "investment_holding",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];
export type SyncKind = (typeof SYNC_KINDS)[number];
export type SyncState = (typeof SYNC_STATES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

/** eToro, the first online broker of Investments (docs/design/investments.md §3.3). */
export const ETORO_PROVIDER = "etoro";
/** Binance through ccxt (§3.2): one provider per exchange (D2). */
export const BINANCE_PROVIDER = "ccxt:binance";

/** The providers a connection may be created for: one entry per provider the app can speak to. */
export const PROVIDERS = [ETORO_PROVIDER, BINANCE_PROVIDER] as const;
export type Provider = (typeof PROVIDERS)[number];

/**
 * The addon whose data a provider of the core reads (H52, PA10): its scheduled reads stop for a
 * person who has that addon off. A plugin's is its manifest's ({@link pluginAddon}).
 */
const PROVIDER_ADDONS: Readonly<Record<string, AddonId>> = {
  [ETORO_PROVIDER]: "investments",
  [BINANCE_PROVIDER]: "investments",
};

export function isKnownProvider(provider: string): provider is Provider {
  return (PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Which kinds each provider syncs, in the order its pass runs them. A provider's engine iterates
 * its own entry rather than `SYNC_KINDS`: adding a kind for one provider must not make another
 * provider record a run for a pass it never makes.
 */
export const KINDS_OF = {
  // Holdings and flows have outcomes of their own (A8): a failed history never stops the value.
  [ETORO_PROVIDER]: ["holdings", "flows"],
  [BINANCE_PROVIDER]: ["holdings", "flows"],
} as const satisfies Record<Provider, readonly SyncKind[]>;

/**
 * Whether a provider brings in movements, so an account of its own can have month ends rebuilt
 * from them (`rebuildDerivedBalances`). An investment provider never does: its accounts have one
 * writer, the `portfolio` source (docs/design/investments.md §1.7).
 */
export function syncsTransactions(provider: string | null): boolean {
  if (provider === null) return false;
  if (isKnownProvider(provider)) return (KINDS_OF[provider] as readonly SyncKind[]).includes("transactions");
  // A plugin's accounts take their movements from the plugin: the kinds of a plugin's pass.
  return isPluginProvider(provider) && (PLUGIN_KINDS as readonly SyncKind[]).includes("transactions");
}

/**
 * The providers of the core that give a category with each movement: their movements keep it and
 * the automatic categories never read them (rewrite plan, 04-now.md §4.4, decision H34). A plugin
 * says the same with `providesCategories` in its manifest. A provider that is not known here — one
 * that reads no movement — is taken as giving its own, so nothing of it is ever recategorised.
 */
const GIVES_NO_CATEGORIES: readonly Provider[] = [];

export function coreProvidesCategories(provider: string): boolean {
  return !(GIVES_NO_CATEGORIES as readonly string[]).includes(provider);
}

/** What the pass of a plugin syncs, in order: the accounts' balances, then the movements. */
export const PLUGIN_KINDS = ["accounts", "transactions"] as const satisfies readonly SyncKind[];

/**
 * The provider of a plugin's connections: `plugin:<id>` (rewrite plan, 04-now.md §4.1). The id is
 * the plugin's own, from its manifest, so the core never lists the plugins it can speak to.
 */
const PLUGIN_PROVIDER = /^plugin:[a-z][a-z0-9-]{1,30}$/;

export function pluginProvider(pluginId: string): string {
  return `plugin:${pluginId}`;
}

export function isPluginProvider(provider: string): boolean {
  return PLUGIN_PROVIDER.test(provider);
}

/** What a leave calendar's pass syncs: its days. */
const LEAVE_KINDS = ["leave"] as const satisfies readonly SyncKind[];

/**
 * What a plugin's pass syncs, in order, from the capabilities of its manifest (rewrite plan R5c,
 * mechanism E5): a leave calendar (`leaveCalendar`) its days; any other plugin — a source read with a
 * token (`source.read`), a bank — the accounts' balances, then the movements.
 */
export function pluginKinds(capabilities: readonly string[]): readonly SyncKind[] {
  return capabilities.includes("leaveCalendar") ? LEAVE_KINDS : PLUGIN_KINDS;
}

/**
 * The addon whose data a provider reads (H52, PA10): its scheduled reads stop for a person who has
 * that addon off. A plugin's comes from its manifest: a leave calendar's days are time off's; any
 * other plugin reads the accounts, which are base. `capabilities` is `null` for a provider of the core.
 */
export function addonOf(provider: string, capabilities: readonly string[] | null): AddonId | undefined {
  if (capabilities === null) return PROVIDER_ADDONS[provider];
  return capabilities.includes("leaveCalendar") ? "timeoff" : undefined;
}

/**
 * Whether a plugin is read by the plugins' own bank pass (`runBankPass`): not a source read with a
 * token nor a leave calendar, which the engines of plugin-host read with their own passes.
 */
export function isBankPlugin(capabilities: readonly string[]): boolean {
  return !capabilities.includes("source.read") && !capabilities.includes("leaveCalendar");
}

export const entityTypeSchema = z.enum(ENTITY_TYPES);

const CREDENTIAL_KEY = /^[a-z][a-z0-9_]{0,39}$/i;
const MAX_CREDENTIALS = 20;

/**
 * A credential bag as `saveConnection` accepts it: the flat record of non-empty strings that
 * `sealJson`/`openJson` round-trip. The caller never sees this schema's error — a rejected value
 * must not reach a log, a stack trace or a form — so the service drops the issues and raises its
 * own `invalid_credentials` instead.
 */
export const credentialsSchema = z
  .record(z.string().regex(CREDENTIAL_KEY), z.string().min(1).max(4096))
  .refine((bag) => {
    const size = Object.keys(bag).length;
    return size >= 1 && size <= MAX_CREDENTIALS;
  });

/**
 * What a plugin's connection seals: the access the provider gave and what it said about it (the
 * accounts it exposes). Wider values than a pasted token, because a list of accounts is one value.
 */
export const pluginConnectionBagSchema = z
  .record(z.string().regex(CREDENTIAL_KEY), z.string().min(1).max(100_000))
  .refine((bag) => {
    const size = Object.keys(bag).length;
    return size >= 1 && size <= MAX_CREDENTIALS;
  });

/**
 * One row of `provider_links` as a caller states it: which local entity a provider's own id
 * stands for. `metadata` left out keeps whatever is already stored, so a sync that knows less
 * than the one before it does not erase what it does not carry.
 */
export const providerLinkSchema = z.object({
  provider: z
    .string()
    .trim()
    .refine((provider) => isKnownProvider(provider) || isPluginProvider(provider)),
  entityType: entityTypeSchema,
  entityId: z.uuid(),
  externalId: z.string().trim().min(1).max(200),
  metadata: z.record(z.string().min(1).max(60), z.string().max(400)).nullish().default(null),
});
export type ProviderLink = z.input<typeof providerLinkSchema>;

/** How often a connection is synced (spec §10.2: the hourly tier). */
export const SYNC_INTERVAL_HOURS = 1;

/** When the next pass of a sync is expected, written on `sync_jobs.next_run_at`. */
export function nextRunAt(from: Date, intervalHours: number = SYNC_INTERVAL_HOURS): Date {
  return new Date(from.getTime() + intervalHours * 3_600_000);
}

/** A finished run either carries an error or it does not: there is no partial success. */
export function outcomeState(outcome: { error?: string | null }): Extract<SyncState, "success" | "failed"> {
  return outcome.error === null || outcome.error === undefined ? "success" : "failed";
}

/** What a finished run says about the connection itself: it worked, or it did not. */
export function connectionStateAfter(outcome: {
  error?: string | null;
}): Extract<ConnectionState, "active" | "error"> {
  return outcomeState(outcome) === "success" ? "active" : "error";
}

const MAX_ERROR_LENGTH = 500;

/**
 * An error as `sync_runs.error` and `last_error` store it: one line, bounded. A provider that
 * answers a request with an HTML page would otherwise put the whole page in the database, and an
 * interface would show it.
 */
export function syncErrorText(message: string, max: number = MAX_ERROR_LENGTH): string {
  const single = message.replace(/\s+/g, " ").trim();
  return single.length <= max ? single : `${single.slice(0, max - 1)}…`;
}

/**
 * The counts of a run, made storable: `jsonb` has no NaN and no Infinity, and a negative or
 * fractional count is a bug in the caller, not a number to keep. Keys are sorted so two runs that
 * counted the same thing store the same object.
 */
export function normalizeCounts(counts: Record<string, number>): Record<string, number> {
  const clean: Record<string, number> = {};
  for (const key of Object.keys(counts).sort()) {
    const value = counts[key];
    if (!Number.isFinite(value)) continue;
    clean[key] = Math.max(0, Math.round(value));
  }
  return clean;
}
