/**
 * The state of a connection as a person reads it (rewrite plan, 04-now.md §4.3;
 * ux/n2-connection-status.md §2, §4, §5, §6): one vocabulary of five values for every provider,
 * the closed list of the error codes, and what a reading is in the history.
 *
 * Pure rules: no database, no network, no provider's name. The pages translate what these
 * functions return; nothing here builds a sentence.
 */
import { civilDateIn, daysBetween } from "../../shared/dates";

/* The error codes */

/** Why a reading failed, as a connection and a run keep it: a code of this list, never a message. */
export const SYNC_ERROR_CODES = [
  "auth",
  "consent_expired",
  "rate_limited",
  "provider_down",
  "invalid_data",
] as const;
type SyncErrorCode = (typeof SYNC_ERROR_CODES)[number];

export function isSyncErrorCode(value: unknown): value is SyncErrorCode {
  return typeof value === "string" && (SYNC_ERROR_CODES as readonly string[]).includes(value);
}

/** The key of a code's sentence in the catalogue; `failed` for no code, or one the app does not know. */
export function codeKey(
  code: string | null | undefined,
): "auth" | "consentExpired" | "rateLimited" | "providerDown" | "invalidData" | "failed" {
  if (code === "auth") return "auth";
  if (code === "consent_expired") return "consentExpired";
  if (code === "rate_limited") return "rateLimited";
  if (code === "provider_down") return "providerDown";
  if (code === "invalid_data") return "invalidData";
  return "failed";
}

function field(cause: unknown, name: string): unknown {
  return typeof cause === "object" && cause !== null ? (cause as Record<string, unknown>)[name] : undefined;
}

function codeOfStatus(status: number): SyncErrorCode | null {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_down";
  return null;
}

/** The words the clients of the providers use for a failure, by the code each one means. */
const CODE_OF_WORD: Record<string, SyncErrorCode> = {
  auth: "auth",
  permission: "auth",
  token_rejected: "auth",
  client_rejected: "auth",
  consent_expired: "consent_expired",
  rate_limited: "rate_limited",
  provider_down: "provider_down",
  plugin_down: "provider_down",
  institution_unavailable: "provider_down",
  network: "provider_down",
  timeout: "provider_down",
  unavailable: "provider_down",
  invalid_data: "invalid_data",
  payload: "invalid_data",
  page_truncated: "invalid_data",
};

/**
 * What a thrown failure says, as a code of the closed list and the HTTP status the provider
 * answered with. It reads the fields the clients of the providers already carry (`code`, `kind`,
 * `errorClass`, `status`) and never the message. A failure it cannot place has no code: the
 * interface then says only that the reading did not work.
 */
export function classifyFailure(cause: unknown): { code: SyncErrorCode | null; httpStatus: number | null } {
  const status = field(cause, "status");
  const httpStatus =
    typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
  for (const name of ["code", "errorClass", "kind"]) {
    const word = field(cause, name);
    // `Object.hasOwn`: a word like `__proto__` must not find something on the object's prototype.
    if (typeof word === "string" && Object.hasOwn(CODE_OF_WORD, word)) {
      return { code: CODE_OF_WORD[word], httpStatus };
    }
  }
  return { code: httpStatus === null ? null : codeOfStatus(httpStatus), httpStatus };
}

/* The streak of failures */

/** A finished reading, as the streak needs it. */
interface StreakRun {
  kind: string;
  state: string;
  errorCode: string | null;
}

/**
 * How many readings in a row failed, and the code of the last failure, from the runs of one
 * connection, newest first. A pass of a provider is one run per kind of data, so the streak is
 * counted per kind and the longest one is the connection's: a pass whose balances worked and
 * whose movements failed three times has failed three times.
 *
 * A `rate_limited` run is neither a failure nor a success (decision Q2): it is stepped over. A
 * skipped or running run says nothing either.
 */
export function failureStreak(runs: readonly StreakRun[]): { failures: number; errorCode: string | null } {
  const seen = new Set<string>();
  let failures = 0;
  let errorCode: string | null = null;
  let failing = false;
  const open = new Map<string, number>();
  for (const run of runs) {
    if (run.state !== "success" && run.state !== "failed") continue;
    if (!seen.has(run.kind)) {
      seen.add(run.kind);
      if (run.state === "success") continue;
      // The newest failure among the kinds that are failing now names the connection's code.
      if (!failing) errorCode = run.errorCode;
      failing = true;
      open.set(run.kind, 0);
    }
    const count = open.get(run.kind);
    if (count === undefined) continue;
    if (run.state === "success") {
      open.delete(run.kind);
      continue;
    }
    if (run.errorCode === "rate_limited") continue;
    open.set(run.kind, count + 1);
    failures = Math.max(failures, count + 1);
  }
  return { failures, errorCode: failing ? errorCode : null };
}

/* The five values */

export type StatusValue = "ok" | "running" | "late" | "action" | "paused";

/** Which sentence a state shows (ux §2.3): the page gives it its words. */
export type StatusText =
  | "ok"
  | "running"
  | "late"
  | "lateNever"
  | "lateLimit"
  | "consentExpired"
  | "keyInvalid"
  | "pending"
  | "pausedSchedule"
  | "pausedProvider";

/** The one thing a person can do about a state. */
type StatusAction = "update" | "renew" | "replaceKey" | "chooseAccounts" | "resume" | "enable";

export interface StatusFacts {
  state: "active" | "error" | "revoked";
  errorCode: string | null;
  consecutiveFailures: number;
  lastOkAt: Date | null;
  nextSyncAt: Date | null;
  /** When the access the person gave ends; null for an access with no end. */
  expiresAt: Date | null;
  /** A reading of this connection is running now (an orphan does not count). */
  running: boolean;
  /** False for a connection of a plugin the person turned off (decision H30). */
  providerActive: boolean;
  /** The connection has at least one rule of schedule. */
  scheduled: boolean;
  /** False while the person has given the access and has not chosen the accounts yet. */
  accountsChosen: boolean;
}

export interface SyncStatus {
  value: StatusValue;
  text: StatusText;
  action: StatusAction | null;
}

/**
 * How long after its time a scheduled reading may still be on its way. This is "the interval"
 * of the plan: a connection is late when the reading its own schedule owed did not happen, and
 * its schedule is the only interval it has.
 */
const OVERDUE_GRACE_MINUTES = 15;

/**
 * The state of one connection: the first rule that holds, in the order of ux §2.2.
 *
 * 1. a plugin the person turned off; 2. a reading in progress; 3. something only the person can
 * repair (an access that ended, a key the provider refuses, accounts not chosen yet); 4. no
 * schedule; 5. a failure or a reading that did not come; 6. up to date.
 */
export function syncStatus(facts: StatusFacts, now: Date): SyncStatus {
  if (!facts.providerActive) return { value: "paused", text: "pausedProvider", action: "enable" };
  if (facts.running) return { value: "running", text: "running", action: null };

  const expired = facts.expiresAt !== null && facts.expiresAt.getTime() <= now.getTime();
  if (expired || facts.errorCode === "consent_expired") {
    return { value: "action", text: "consentExpired", action: "renew" };
  }
  if (facts.errorCode === "auth" || facts.state === "revoked") {
    return { value: "action", text: "keyInvalid", action: "replaceKey" };
  }
  if (!facts.accountsChosen) return { value: "action", text: "pending", action: "chooseAccounts" };

  if (!facts.scheduled) return { value: "paused", text: "pausedSchedule", action: "resume" };

  if (facts.errorCode === "rate_limited") return { value: "late", text: "lateLimit", action: "update" };
  const overdue =
    facts.nextSyncAt !== null && now.getTime() - facts.nextSyncAt.getTime() > OVERDUE_GRACE_MINUTES * 60_000;
  if (facts.lastOkAt === null) return { value: "late", text: "lateNever", action: "update" };
  if (facts.consecutiveFailures >= 1 || facts.state === "error" || overdue) {
    return { value: "late", text: "late", action: "update" };
  }
  return { value: "ok", text: "ok", action: null };
}

/* The warnings (ux §6) */

/** The failures in a row after which a person is told (ux §6.1). */
const FAILURES_BEFORE_WARNING = 3;

/** The one obsolescence constant (spec §7.1): past this many hours with no good reading, a source is stale. */
export const STALE_AFTER_HOURS = 36;

/** The days before the end of an access at which a person is told, the nearer one last. */
type ExpiryWarningDays = 14 | 3;

/**
 * The whole days left before an access ends, in the person's zone: 0 on the day itself. `null`
 * for an access with no end, or one that has ended.
 */
export function daysToExpiry(expiresAt: Date | null, now: Date, timeZone: string): number | null {
  if (expiresAt === null || expiresAt.getTime() <= now.getTime()) return null;
  return Math.max(0, daysBetween(civilDateIn(now, timeZone), civilDateIn(expiresAt, timeZone)));
}

/** The warning a number of days left belongs to: 3 from the third day, 14 from the fourteenth. */
export function expiryWarning(days: number | null): ExpiryWarningDays | null {
  if (days === null) return null;
  if (days <= 3) return 3;
  return days <= 14 ? 14 : null;
}

/** Which warning a connection is owed after a reading, if any (ux §6.1, §6.5). */
type Warning = { kind: "failed"; todo: "renew" | "replaceKey" | null } | { kind: "stale" } | null;

export function warningFor(status: SyncStatus, facts: StatusFacts, now: Date): Warning {
  // A plugin turned off, a schedule turned off, accounts not chosen: the person already knows.
  if (status.value === "paused" || status.text === "pending") return null;
  if (status.value === "action") {
    return { kind: "failed", todo: status.action === "renew" ? "renew" : "replaceKey" };
  }
  if (facts.consecutiveFailures >= FAILURES_BEFORE_WARNING) return { kind: "failed", todo: null };
  if (facts.lastOkAt !== null && now.getTime() - facts.lastOkAt.getTime() > STALE_AFTER_HOURS * 3_600_000) {
    return { kind: "stale" };
  }
  return null;
}

/* Times as a person says them (ux §2.3): in `packages/format`, which a client shares (19/11/2026). */

export { clock, relativeNext, relativePast } from "../../shared/dates";

/* The history (ux §4) */

/** A run of `sync_runs`, as the history and the log read it. */
interface HistoryRun {
  kind: string;
  state: string;
  origin: string | null;
  errorCode: string | null;
  counts: Record<string, number> | null;
  startedAt: Date;
}

/** What a reading brought, by kind of data: the key of its sentence and the counts it adds up. */
const NEWS: Record<string, readonly { key: string; from: readonly string[] }[]> = {
  accounts: [
    { key: "accountsNew", from: ["created"] },
    { key: "balancesUpdated", from: ["updated"] },
  ],
  transactions: [
    { key: "movementsNew", from: ["created"] },
    { key: "movementsUpdated", from: ["updated"] },
  ],
  leave: [
    { key: "daysSent", from: ["applied"] },
    { key: "daysReceived", from: ["adopted"] },
  ],
  holdings: [{ key: "positionsRead", from: ["created"] }],
  flows: [{ key: "operationsNew", from: ["created"] }],
};

type HistoryOutcome = "ok" | "failed" | "running" | "skipped";

interface HistoryEntry {
  at: Date;
  outcome: HistoryOutcome;
  /** For a failed reading: its code, or null for one with none (a run older than the codes). */
  errorCode: SyncErrorCode | null;
  /** For a good reading: what was new, in the order of the kinds; empty for "nothing new". */
  news: { key: string; count: number }[];
  /** The person started it. */
  manual: boolean;
}

/** The runs of one pass start one after the other: within this long they are one reading. */
const SAME_READING_MS = 15 * 60_000;

const OUTCOME_ORDER: HistoryOutcome[] = ["running", "failed", "ok", "skipped"];

function outcomeOf(state: string): HistoryOutcome {
  if (state === "success") return "ok";
  return state === "failed" || state === "running" || state === "skipped" ? state : "failed";
}

/**
 * The readings of one connection, newest first, from its runs, newest first. A provider reads
 * more than one kind of data in a pass, and a person calls the pass one reading: the runs of a
 * pass — different kinds, the same origin, started close together — become one entry, with the
 * worst of their outcomes and the sum of what they brought.
 */
export function historyOf(runs: readonly HistoryRun[]): HistoryEntry[] {
  const groups: HistoryRun[][] = [];
  for (const run of runs) {
    const group = groups.at(-1);
    const first = group?.at(-1);
    if (
      group &&
      first &&
      first.origin === run.origin &&
      !group.some((one) => one.kind === run.kind) &&
      first.startedAt.getTime() - run.startedAt.getTime() < SAME_READING_MS
    ) {
      group.push(run);
    } else {
      groups.push([run]);
    }
  }
  return groups.map((group) => {
    const outcomes = group.map((run) => outcomeOf(run.state));
    const outcome = OUTCOME_ORDER.find((one) => outcomes.includes(one)) ?? "ok";
    const failed = group.find((run) => run.state === "failed");
    const news = [...group]
      .reverse()
      .filter((run) => run.state === "success")
      .flatMap((run) =>
        (NEWS[run.kind] ?? []).map(({ key, from }) => ({
          key,
          count: from.reduce((sum, name) => sum + (run.counts?.[name] ?? 0), 0),
        })),
      )
      .filter((one) => one.count > 0);
    return {
      at: (group.at(-1) as HistoryRun).startedAt,
      outcome,
      errorCode: outcome === "failed" && isSyncErrorCode(failed?.errorCode) ? failed.errorCode : null,
      news: outcome === "ok" ? news : [],
      manual: group.some((run) => run.origin === "manual"),
    };
  });
}

/** How old a run that never ended has to be before nobody is running it any more. */
export const ORPHAN_AFTER_MS = 3_600_000;

/** Whether a run is a reading in progress: running, and not an orphan. */
export function isRunningNow(run: { state: string; startedAt: Date }, now: Date): boolean {
  return run.state === "running" && now.getTime() - run.startedAt.getTime() < ORPHAN_AFTER_MS;
}
