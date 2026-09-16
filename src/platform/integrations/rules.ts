/**
 * The vocabulary the integration tables are built on. Kept here rather than in `schema.ts` so the
 * tables and the pure rules that reason about them share one source (same split as
 * `modules/accounts/rules.ts`).
 */
import { z } from "zod";

export const CONNECTION_STATES = ["active", "error", "revoked"] as const;
export const SYNC_KINDS = ["accounts", "transactions"] as const;
export const SYNC_STATES = ["running", "success", "failed", "skipped"] as const;
export const ENTITY_TYPES = ["account", "transaction", "category"] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];
export type SyncKind = (typeof SYNC_KINDS)[number];
export type SyncState = (typeof SYNC_STATES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

/** The only provider F2 speaks to. Later phases add their own (spec §9.2). */
export const WALLET_PROVIDER = "wallet";

/** The providers a connection may be created for: one entry per provider the app can speak to. */
export const PROVIDERS = [WALLET_PROVIDER] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isKnownProvider(provider: string): provider is Provider {
  return (PROVIDERS as readonly string[]).includes(provider);
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
 * One row of `provider_links` as a caller states it: which local entity a provider's own id
 * stands for. `metadata` left out keeps whatever is already stored, so a sync that knows less
 * than the one before it does not erase what it does not carry.
 */
export const providerLinkSchema = z.object({
  provider: z.string().trim().refine(isKnownProvider),
  entityType: entityTypeSchema,
  entityId: z.uuid(),
  externalId: z.string().trim().min(1).max(200),
  metadata: z.record(z.string().min(1).max(60), z.string().max(400)).nullish().default(null),
});
export type ProviderLink = z.input<typeof providerLinkSchema>;

/** How often a connection is synced (spec §10.2: the hourly tier). */
export const SYNC_INTERVAL_HOURS = 1;

export interface SeenLink {
  externalId: string;
  missingSince: Date | null;
}

/**
 * What a sighting changes, split so the caller writes each group once. `present` and `returned`
 * both move `last_seen_at`; only `returned` clears `missing_since`. `stillMissing` is
 * deliberately untouched: keeping the original `missing_since` is what makes a repeated sync
 * idempotent, instead of pushing the disappearance forward by an hour every hour.
 *
 * `missing` is the whole of "gone from the provider" (spec §7.2): the re-read window *is* the
 * tolerance, so a link absent from an answer that covered its date is absent now, with no grace
 * period on top. `missing_since` records when that happened; it never gates it.
 */
export interface LinkPresence {
  present: string[];
  returned: string[];
  missing: string[];
  stillMissing: string[];
  unknown: string[];
}

/**
 * Reconciles the links already stored against the external ids the provider just returned.
 *
 * `known` must hold only the links the answer was expected to cover — for a 7-day re-read, the
 * links of those 7 days. A link outside the window is not absent, it was never asked for, and
 * handing it in here would mark a year of history as disappeared. Each list keeps the order it
 * arrived in, so the same input always produces the same writes.
 */
export function reconcileExternalIds(
  known: readonly SeenLink[],
  externalIds: readonly string[],
): LinkPresence {
  const returned = new Set(externalIds);
  const presence: LinkPresence = { present: [], returned: [], missing: [], stillMissing: [], unknown: [] };
  const linked = new Set<string>();
  for (const link of known) {
    linked.add(link.externalId);
    if (returned.has(link.externalId)) {
      (link.missingSince === null ? presence.present : presence.returned).push(link.externalId);
    } else {
      (link.missingSince === null ? presence.missing : presence.stillMissing).push(link.externalId);
    }
  }
  const unknown = new Set<string>();
  for (const externalId of externalIds) {
    if (linked.has(externalId) || unknown.has(externalId)) continue;
    unknown.add(externalId);
    presence.unknown.push(externalId);
  }
  return presence;
}

/** When the next pass of a sync is expected, written on `sync_jobs.next_run_at`. */
export function nextRunAt(from: Date, intervalHours: number = SYNC_INTERVAL_HOURS): Date {
  return new Date(from.getTime() + intervalHours * 3_600_000);
}

/** A job that has never run is due at once; the hourly tick decides the rest (spec §10.2). */
export function isDue(job: { nextRunAt: Date | null }, now: Date = new Date()): boolean {
  return job.nextRunAt === null || job.nextRunAt.getTime() <= now.getTime();
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
