/**
 * The vocabulary the integration tables are built on. Kept here rather than in `schema.ts` so the
 * tables and the pure rules that reason about them share one source (same split as
 * `modules/accounts/rules.ts`).
 */
import { z } from "zod";
import { addDays, civilDateIn, wallClockIn } from "@/platform/dates";

export const CONNECTION_STATES = ["active", "error", "revoked"] as const;
/**
 * Every kind of pass any provider can make. A provider makes only its own (`KINDS_OF`): this list
 * is the column's vocabulary, not a to-do list anybody works through.
 */
export const SYNC_KINDS = ["accounts", "transactions", "leave", "documents"] as const;
export const SYNC_STATES = ["running", "success", "failed", "skipped"] as const;
/** `category_group` is a Wallet category group, filed as the local parent category (F2.5). */
export const ENTITY_TYPES = [
  "account",
  "transaction",
  "category",
  "category_group",
  "interest_entry",
] as const;

export type ConnectionState = (typeof CONNECTION_STATES)[number];
export type SyncKind = (typeof SYNC_KINDS)[number];
export type SyncState = (typeof SYNC_STATES)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];

/** The provider F2 speaks to: accounts and movements. */
export const WALLET_PROVIDER = "wallet";
/** The provider F7 speaks to (spec §9.2): the leave calendar, over MCP. */
export const TREK_PROVIDER = "trek";
/** Paperless-ngx, read by Ledgerly (docs/auth-design.md D5): payslips and Cometa documents. */
export const PAPERLESS_PROVIDER = "paperless";

/** The providers a connection may be created for: one entry per provider the app can speak to. */
export const PROVIDERS = [WALLET_PROVIDER, TREK_PROVIDER, PAPERLESS_PROVIDER] as const;
export type Provider = (typeof PROVIDERS)[number];

export function isKnownProvider(provider: string): provider is Provider {
  return (PROVIDERS as readonly string[]).includes(provider);
}

/**
 * Which kinds each provider syncs, in the order its pass runs them. A provider's engine iterates
 * its own entry rather than `SYNC_KINDS`: adding a kind for one provider must not make another
 * provider record a run for a pass it never makes.
 */
export const KINDS_OF = {
  [WALLET_PROVIDER]: ["accounts", "transactions"],
  [TREK_PROVIDER]: ["leave"],
  [PAPERLESS_PROVIDER]: ["documents"],
} as const satisfies Record<Provider, readonly SyncKind[]>;

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

/* When a connection syncs (docs/auth-design.md D7) */

/** The intervals a person may choose, in minutes: never below the 15-minute tick of the cron. */
export const SYNC_INTERVALS = [15, 30, 60, 120, 180, 240, 360, 720, 1440] as const;
export type SyncInterval = (typeof SYNC_INTERVALS)[number];
export const MAX_SYNC_TIMES = 6;
export const SYNC_MODES = ["interval", "times", "manual"] as const;

const TIME_OF_DAY = /^([01]\d|2[0-3]):(00|15|30|45)$/;

/**
 * One schedule per connection, in one of three shapes: every N minutes from local midnight, at up
 * to six times of the day (quarter hours), or only on "Sync now". A free cron expression was
 * turned down (D7): hard to check, and one typo can hammer a provider's API.
 */
export const syncScheduleSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("interval"),
    everyMinutes: z
      .number()
      .refine((value): value is SyncInterval => (SYNC_INTERVALS as readonly number[]).includes(value)),
  }),
  z.object({
    mode: z.literal("times"),
    times: z
      .array(z.string().regex(TIME_OF_DAY))
      .min(1)
      .max(MAX_SYNC_TIMES)
      .transform((times) => [...new Set(times)].sort()),
  }),
  z.object({ mode: z.literal("manual") }),
]);
export type SyncSchedule = z.output<typeof syncScheduleSchema>;

/** Today's behaviour, and the default of every connection: once an hour (spec §10.2). */
export const DEFAULT_SYNC_SCHEDULE: SyncSchedule = { mode: "interval", everyMinutes: 60 };

/** A stored schedule read back: anything that no longer parses is the default, never a crash. */
export function parseSyncSchedule(value: unknown): SyncSchedule {
  const parsed = syncScheduleSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_SYNC_SCHEDULE;
}

function minutesOf(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** The wall-clock minutes of a day at which a schedule runs, ascending. */
export function slotsOf(schedule: SyncSchedule): number[] {
  if (schedule.mode === "manual") return [];
  if (schedule.mode === "times") return schedule.times.map(minutesOf);
  const slots: number[] = [];
  for (let minute = 0; minute < 24 * 60; minute += schedule.everyMinutes) slots.push(minute);
  return slots;
}

/**
 * The first instant strictly after `after` at which the schedule runs, in the person's own zone;
 * null for `manual`. Slots are local wall-clock times, so "07:00" stays 07:00 across a change of
 * daylight saving time; a time the clock skips runs as far after the jump as it was meant to. The previous and
 * the next two days are looked at so that no zone's offset can push the answer out of the window.
 */
export function nextSyncAt(schedule: SyncSchedule, timeZone: string, after: Date): Date | null {
  const slots = slotsOf(schedule);
  if (slots.length === 0) return null;
  const today = civilDateIn(after, timeZone);
  let best: Date | null = null;
  for (let offset = -1; offset <= 2; offset += 1) {
    const day = addDays(today, offset);
    for (const minutes of slots) {
      const at = wallClockIn(day, minutes, timeZone);
      if (at.getTime() > after.getTime() && (best === null || at.getTime() < best.getTime())) best = at;
    }
  }
  return best;
}

/** How often a connection is synced (spec §10.2: the hourly tier). */
export const SYNC_INTERVAL_HOURS = 1;

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
